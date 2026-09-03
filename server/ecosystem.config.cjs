module.exports = {
  apps: [
    {
      name: 'gfl2-community-api',
      cwd: __dirname,
      script: 'dist/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        PORT: 8787,
      },
    },
  ],
};
