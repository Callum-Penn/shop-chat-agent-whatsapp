#!/bin/bash

# Generate Prisma client
npx prisma generate

# Push database schema (create tables)
npx prisma db push

# Start the app
remix-serve ./build/server/index.js --host 0.0.0.0 