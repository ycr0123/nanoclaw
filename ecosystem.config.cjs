module.exports = {
  apps: [
    {
      name: 'nanoclaw',
      script: 'dist/index.js',
      interpreter: 'C:\\Program Files\\nodejs\\node.exe',
      cwd: 'C:\\Users\\YCR\\workspace_github\\nanoclaw',
      env: {
        PATH: [
          'C:\\Program Files\\Docker\\Docker\\resources\\bin',
          'C:\\Program Files\\nodejs',
          'C:\\Users\\YCR\\AppData\\Local\\Programs\\Python\\Python312',
          process.env.PATH,
        ].join(';'),
      },
      out_file: 'C:\\Users\\YCR\\workspace_github\\nanoclaw\\logs\\pm2-out.log',
      error_file: 'C:\\Users\\YCR\\workspace_github\\nanoclaw\\logs\\pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_restarts: 5,
      restart_delay: 3000,
    },
  ],
};
