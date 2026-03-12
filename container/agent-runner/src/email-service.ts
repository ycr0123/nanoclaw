/**
 * Email Service for NanoClaw (Container-side)
 * POP3 수신 + SMTP 발송을 캡슐화
 */

import Pop3Client from 'node-pop3';
import { simpleParser, ParsedMail } from 'mailparser';
import nodemailer from 'nodemailer';

export interface EmailConfig {
  email: string;
  password: string;
  domain: string;
}

export interface EmailSummary {
  number: number;
  uid: string;
  from: string;
  subject: string;
  date: string;
  size: number;
}

export interface EmailDetail {
  number: number;
  uid: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  isHtml: boolean;
  attachments: Array<{ filename: string; size: number; contentType: string }>;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  isHtml?: boolean;
}

// 일일 발송 카운터 (프로세스 메모리)
let dailySendCount = 0;
let dailyCountDate = '';
const DAILY_SEND_LIMIT = 400;

function resetDailyCountIfNeeded(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyCountDate !== today) {
    dailySendCount = 0;
    dailyCountDate = today;
  }
}

export function getDailySendCount(): { count: number; limit: number } {
  resetDailyCountIfNeeded();
  return { count: dailySendCount, limit: DAILY_SEND_LIMIT };
}

/**
 * POP3 접속하여 최근 N개 메일 목록 반환
 */
export async function listEmails(
  config: EmailConfig,
  count: number = 20,
): Promise<EmailSummary[]> {
  const pop3 = new Pop3Client({
    host: `webmail.${config.domain}`,
    port: 110,
    tls: false,
    user: config.email,
    password: config.password,
  });

  try {
    // UIDL로 고유 ID 획득
    let uidlList: string[][];
    try {
      const raw = await pop3.UIDL();
      uidlList = Array.isArray(raw) ? (raw as string[][]) : [];
    } catch {
      // UIDL 미지원 시 빈 배열로 폴백
      uidlList = [];
    }

    // LIST로 메시지 번호/크기 획득
    const listResult = await pop3.LIST();
    const msgList = Array.isArray(listResult) ? (listResult as string[][]) : [];

    if (msgList.length === 0) return [];

    // 최근 N개만 처리 (번호가 큰 것이 최신)
    const recentMessages = msgList.slice(-count);

    const uidMap = new Map(uidlList.map(([num, uid]) => [num, uid]));

    const summaries: EmailSummary[] = [];

    for (const [msgNum, msgSize] of recentMessages) {
      try {
        // TOP 명령으로 헤더만 가져오기 (본문 0줄)
        const topResult = await pop3.TOP(Number(msgNum), 0);
        const parsed = await simpleParser(topResult);

        summaries.push({
          number: Number(msgNum),
          uid: uidMap.get(msgNum) || `msg-${msgNum}-${msgSize}`,
          from: parsed.from?.text || '(unknown)',
          subject: parsed.subject || '(no subject)',
          date: parsed.date?.toISOString() || '',
          size: Number(msgSize),
        });
      } catch {
        // 개별 메일 파싱 실패 시 기본 정보로 추가
        summaries.push({
          number: Number(msgNum),
          uid: uidMap.get(msgNum) || `msg-${msgNum}-${msgSize}`,
          from: '(parse error)',
          subject: '(parse error)',
          date: '',
          size: Number(msgSize),
        });
      }
    }

    // 최신순 정렬 (번호 내림차순)
    summaries.sort((a, b) => b.number - a.number);

    return summaries;
  } finally {
    try {
      await pop3.QUIT();
    } catch {
      // 연결 종료 실패 무시
    }
  }
}

/**
 * POP3 접속하여 특정 메일 본문 읽기
 */
export async function readEmail(
  config: EmailConfig,
  messageNumber: number,
): Promise<EmailDetail> {
  const pop3 = new Pop3Client({
    host: `webmail.${config.domain}`,
    port: 110,
    tls: false,
    user: config.email,
    password: config.password,
  });

  try {
    // UIDL 획득
    let uid = `msg-${messageNumber}`;
    try {
      const uidlResult = await pop3.UIDL(messageNumber);
      if (typeof uidlResult === 'string') {
        uid = uidlResult;
      } else if (Array.isArray(uidlResult) && uidlResult.length >= 2) {
        uid = String(uidlResult[1]);
      }
    } catch {
      // UIDL 미지원 시 기본값 사용
    }

    const rawEmail = await pop3.RETR(messageNumber);
    const parsed: ParsedMail = await simpleParser(rawEmail);

    // 본문 추출 (텍스트 우선, 없으면 HTML)
    let body = parsed.text || '';
    let isHtml = false;

    if (!body && parsed.html) {
      // HTML에서 태그 제거하여 텍스트 추출
      body = parsed.html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      isHtml = true;
    }

    // 2000자 제한
    if (body.length > 2000) {
      body = body.slice(0, 2000) + '\n\n... (본문이 2000자를 초과하여 잘렸습니다)';
    }

    const attachments = (parsed.attachments || []).map((att) => ({
      filename: att.filename || '(unnamed)',
      size: att.size,
      contentType: att.contentType,
    }));

    return {
      number: messageNumber,
      uid,
      from: parsed.from?.text || '(unknown)',
      to: parsed.to
        ? Array.isArray(parsed.to)
          ? parsed.to.map((t) => t.text).join(', ')
          : parsed.to.text
        : '',
      subject: parsed.subject || '(no subject)',
      date: parsed.date?.toISOString() || '',
      body,
      isHtml,
      attachments,
    };
  } finally {
    try {
      await pop3.QUIT();
    } catch {
      // 연결 종료 실패 무시
    }
  }
}

/**
 * SMTP로 이메일 발송
 */
export async function sendEmail(
  config: EmailConfig,
  params: SendEmailParams,
): Promise<{ success: boolean; message: string }> {
  resetDailyCountIfNeeded();

  if (dailySendCount >= DAILY_SEND_LIMIT) {
    return {
      success: false,
      message: `일일 발송 한도(${DAILY_SEND_LIMIT}통)에 도달했습니다. 현재 ${dailySendCount}통 발송됨.`,
    };
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.cafe24.com',
    port: 587,
    secure: false, // STARTTLS 자동 업그레이드
    auth: {
      user: config.email,
      pass: config.password,
    },
  });

  try {
    await transporter.sendMail({
      from: config.email,
      to: params.to,
      cc: params.cc,
      subject: params.subject,
      ...(params.isHtml ? { html: params.body } : { text: params.body }),
    });

    dailySendCount++;

    return {
      success: true,
      message: `메일 발송 완료. 오늘 발송: ${dailySendCount}/${DAILY_SEND_LIMIT}통`,
    };
  } catch (err) {
    return {
      success: false,
      message: `메일 발송 실패: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
