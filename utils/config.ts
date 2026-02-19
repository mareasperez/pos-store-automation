import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
// Prioritize local .env in automation directory, then fallback to root .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  baseUrl: process.env.BASE_URL || 'http://localhost:5173',
  apiUrl: process.env.API_URL || 'http://localhost:8081',
  credentials: {
    username: process.env.TEST_USERNAME || 'admin',
    password: process.env.TEST_PASSWORD || 'admin',
  },
  tenantId: process.env.TEST_TENANT_ID?.trim() || null,
};
