/**
 * Email Poller for NanoClaw (Host-side)
 * 5분마다 POP3 접속하여 새 메일 체크 후 Slack/Telegram 알림
 */

import fs from 'fs';
import path from 'path';
import Pop3Client from 'node-pop3';
import { simpleParser } from 'mailparser';
import { logger } from './logger.js';
import { STORE_DIR } from './config.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5분
const MAX_SEEN_UIDS = 5000;
const SEEN_UIDS_FILE = path.join(STORE_DIR, 'email-seen-uids.json');

interface EmailPollerDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  notificationJids: string[];
  config: {
    email: string;
    password: string;
    domain: string;
  };
}

function loadSeenUids(): Set<string> {
  try {
    if (fs.existsSync(SEEN_UIDS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SEEN_UIDS_FILE, 'utf-8'));
      return new Set(Array.isArray(data) ? data : []);
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load seen UIDs, starting fresh');
  }
  return new Set();
}

function saveSeenUids(uids: Set<string>): void {
  try {
    // 최근 500개만 유지
    const arr = Array.from(uids);
    const trimmed =
      arr.length > MAX_SEEN_UIDS ? arr.slice(arr.length - MAX_SEEN_UIDS) : arr;
    fs.mkdirSync(path.dirname(SEEN_UIDS_FILE), { recursive: true });
    fs.writeFileSync(SEEN_UIDS_FILE, JSON.stringify(trimmed, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save seen UIDs');
  }
}

async function pollForNewEmails(deps: EmailPollerDeps): Promise<void> {
  const { config, sendMessage, notificationJids } = deps;

  if (notificationJids.length === 0) {
    logger.debug('No notification JIDs configured for email poller');
    return;
  }

  let pop3: Pop3Client | null = null;

  try {
    pop3 = new Pop3Client({
      host: `webmail.${config.domain}`,
      port: 110,
      tls: false,
      user: config.email,
      password: config.password,
    });

    // UIDL로 고유 ID 획득
    let uidlList: string[][];
    try {
      const raw = await pop3.UIDL();
      uidlList = Array.isArray(raw) ? (raw as string[][]) : [];
    } catch {
      // UIDL 미지원 시 LIST 기반 해시로 대체
      const listResult = await pop3.LIST();
      const msgList = Array.isArray(listResult)
        ? (listResult as string[][])
        : [];
      uidlList = msgList.map(([num, size]) => [num, `${num}-${size}`]);
    }

    if (uidlList.length === 0) {
      logger.debug('No emails in mailbox');
      return;
    }

    const seenUids = loadSeenUids();
    const isFirstRun = seenUids.size === 0;

    // 새 메일 식별
    const newMessages: Array<{ num: string; uid: string }> = [];
    for (const [num, uid] of uidlList) {
      if (!seenUids.has(uid)) {
        newMessages.push({ num, uid });
      }
    }

    if (isFirstRun) {
      // 첫 실행: 모든 UID를 seen으로 마킹 (기존 메일 알림 방지)
      for (const [, uid] of uidlList) {
        seenUids.add(uid);
      }
      saveSeenUids(seenUids);
      logger.info(
        { count: uidlList.length },
        'Email poller first run: marked all existing emails as seen',
      );
      return;
    }

    if (newMessages.length === 0) {
      logger.debug('No new emails');
      return;
    }

    logger.info({ count: newMessages.length }, 'New emails detected');

    // 최근 10개만 알림 (대량 수신 시 제한)
    const toNotify = newMessages.slice(-10);

    for (const { num, uid } of toNotify) {
      try {
        const topResult = await pop3.TOP(Number(num), 0);
        const parsed = await simpleParser(topResult);

        const from = parsed.from?.text || '(unknown)';
        const subject = parsed.subject || '(no subject)';
        const date = parsed.date
          ? parsed.date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
          : '';

        const notification = [
          '*새 이메일 도착*',
          `보낸이: ${from}`,
          `제목: ${subject}`,
          `시간: ${date}`,
        ].join('\n');

        for (const jid of notificationJids) {
          try {
            await sendMessage(jid, notification);
          } catch (err) {
            logger.warn({ jid, err }, 'Failed to send email notification');
          }
        }
      } catch (err) {
        logger.warn({ num, err }, 'Failed to parse email for notification');
      }

      seenUids.add(uid);
    }

    // 알림 안 보낸 메일도 seen으로 마킹
    for (const { uid } of newMessages) {
      seenUids.add(uid);
    }

    saveSeenUids(seenUids);
  } catch (err) {
    logger.error({ err }, 'Email polling failed');
  } finally {
    if (pop3) {
      try {
        await pop3.QUIT();
      } catch {
        // 연결 종료 실패 무시
      }
    }
  }
}

export function startEmailPoller(deps: EmailPollerDeps): void {
  logger.info(
    { notificationJids: deps.notificationJids },
    'Starting email poller (5min interval)',
  );

  // 시작 시 즉시 1회 실행
  pollForNewEmails(deps).catch((err) =>
    logger.error({ err }, 'Initial email poll failed'),
  );

  // 5분마다 반복
  setInterval(() => {
    pollForNewEmails(deps).catch((err) =>
      logger.error({ err }, 'Email poll failed'),
    );
  }, POLL_INTERVAL_MS);
}
