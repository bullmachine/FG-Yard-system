module.exports = {
  apps: [
    {
      name: "yard-backend",
      cwd: "./backend",
      script: "dist/index.js",
      env: { NODE_ENV: "production", PORT: 5000 }
    },
    {
      name: "yard-frontend",
      cwd: "./frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      env: { NODE_ENV: "production", PORT: 3000 }
    }
  ]
}