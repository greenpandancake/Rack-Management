module.exports = {
  apps: [
    {
      name: 'mpl-rack-server',
      cwd: './server',
      script: 'dist/index.js',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_memory_restart: '512M',
    },
  ],
};
