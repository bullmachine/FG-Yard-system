module.exports = {
  apps: [
    {
      name: "yard-backend",
      cwd: "./backend",
      script: "dist/index.js",
      env: { NODE_ENV: "production", PORT: 5000 },
      autorestart: true,
      max_restarts: 15,
      min_uptime: "30s",
      restart_delay: 5000,
      kill_timeout: 5000
    },
    {
      name: "yard-frontend",
      cwd: "./frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      env: { NODE_ENV: "production", PORT: 3000 },
      autorestart: true,
      max_restarts: 15,
      min_uptime: "30s",
      restart_delay: 5000,
      kill_timeout: 10000,
      listen_timeout: 15000
    }
  ]
}