import { registerPath } from '../../api/openapi';

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const authResponse = {
  description: 'User + access token (refresh token set as an httpOnly cookie)',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          user: { type: 'object' },
          accessToken: { type: 'string' },
        },
      },
    },
  },
};

export function registerAuthOpenApi(): void {
  registerPath('/auth/register', {
    post: {
      summary: 'Create an account',
      tags: ['Auth'],
      responses: { '201': authResponse, '409': errorResponse('Email already registered'), '400': errorResponse('Validation error') },
    },
  });
  registerPath('/auth/login', {
    post: {
      summary: 'Log in with email + password',
      tags: ['Auth'],
      responses: { '200': authResponse, '401': errorResponse('Invalid credentials') },
    },
  });
  registerPath('/auth/refresh', {
    post: {
      summary: 'Rotate the refresh cookie for a new access token',
      tags: ['Auth'],
      responses: { '200': authResponse, '401': errorResponse('Invalid/expired/reused refresh token') },
    },
  });
  registerPath('/auth/logout', {
    post: { summary: 'Revoke the current refresh token', tags: ['Auth'], responses: { '204': { description: 'Logged out' } } },
  });
  registerPath('/auth/me', {
    get: {
      summary: 'Current authenticated user',
      tags: ['Auth'],
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: 'The current user' }, '401': errorResponse('Unauthenticated') },
    },
  });
}
