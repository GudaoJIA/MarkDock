import http from 'node:http';

const binding = process.env.MARKDOCK_HOST || '0.0.0.0';
const req = http.get(
  {
    hostname:
      binding === '0.0.0.0' ? '127.0.0.1' : binding === '::' ? '::1' : binding,
    port: process.env.PORT || 3000,
    path: '/api/health',
    timeout: 3000,
  },
  (response) => {
    response.resume();
    process.exitCode = response.statusCode === 200 ? 0 : 1;
  }
);
req.on('timeout', () => req.destroy(new Error('Health check timed out')));
req.on('error', () => {
  process.exitCode = 1;
});
