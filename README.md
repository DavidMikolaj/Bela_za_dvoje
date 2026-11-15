# Bela za dvoje

A full-stack, two-player Croatian Bela card game application. This repository contains a React + TypeScript + Vite client and a Node.js + Express + TypeScript server with Socket.IO prepared for real-time communication.

Game rules and play logic are not implemented yet. SQLite is planned; database configuration will be added later.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Install

```sh
npm install
npm install --prefix client
npm install --prefix server
```

## Development

Run both apps from the repository root:

```sh
npm run dev
```

Or start them separately:

```sh
npm run dev --prefix client
npm run dev --prefix server
```

The client runs at `http://localhost:5173`; the server runs at `http://localhost:3000` and exposes `GET /health`.

## Build and checks

```sh
npm run typecheck
npm run build
npm test
```
