#!/bin/bash

# Generate Prisma client
npx prisma generate

# Push database schema (create tables)
npx prisma db push

# Start the app
npm start 