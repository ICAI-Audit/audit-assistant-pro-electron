# ICAI VERA

A comprehensive desktop application for chartered accountants built with Electron, React, and TypeScript. This professional audit tool helps manage audit engagements, trial balances, CARO compliance, and comprehensive audit reporting.

## Features

- **Trial Balance Management** - Import and manage trial balances from Tally and Excel
- **CARO Compliance** - Complete CARO clause library with templated responses
- **Audit Report Generator** - Generate professional audit reports with key audit matters
- **Engagement Management** - Track multiple audit engagements and team assignments
- **Evidence Vault** - Secure document storage and management
- **Risk Register** - Comprehensive risk assessment and management
- **Materiality Calculator** - Automated materiality calculations
- **Procedure Workpapers** - Structured audit procedure documentation

## Development Setup

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd audit-assistant-pro

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the Electron app in development mode
npm run electron:dev

# Alternative: Run web version only (without Electron)
npm run dev
```

## Available Scripts

```sh
# Run Electron app in development mode (with hot reload)
npm run electron:dev

# Run the latest production build locally (run `npm run build` first)
npm run electron

# Build the production version of the app
npm run build

# Build the Electron app for distribution (Windows, Mac, Linux)
npm run electron:build

# Build for specific platform
npm run electron:build:win   # Windows
npm run electron:build:mac   # macOS
npm run electron:build:linux # Linux

# Run web version only (without Electron)
npm run dev

# Preview production build
npm run preview
```

## Technology Stack

This project is built with:

- **Electron** - Desktop application framework
- **Vite** - Fast build tool and dev server
- **TypeScript** - Type-safe JavaScript
- **React** - UI library
- **shadcn-ui** - Beautiful UI components
- **Tailwind CSS** - Utility-first CSS framework
- **Supabase** - Backend and database
- **React Query** - Data fetching and state management
- **React Router** - Client-side routing

## Building for Production

To create a distributable Electron app:

```sh
# Build the React app
npm run build

# Package the Electron app
npm run electron:build
```

The packaged app will be available in the `electron-dist` folder.

## Project Structure

```
audit-assistant-pro/
├── electron/           # Electron main and preload scripts
├── src/               # React application source
│   ├── components/    # React components
│   ├── pages/         # Page components
│   ├── hooks/         # Custom React hooks
│   ├── contexts/      # React context providers
│   ├── services/      # Business logic and services
│   └── integrations/  # External integrations (Supabase)
├── public/            # Static assets
└── dist/              # Production build output
```

## Support

For issues and feature requests, please open an issue on the GitHub repository.
