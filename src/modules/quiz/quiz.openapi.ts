import { registerPath } from '../../api/openapi';

export function registerQuizOpenApi(): void {
  registerPath('/quizzes/{id}/start', {
    post: {
      summary: 'Start (or resume) a timed quiz attempt — the server sets the deadline',
      tags: ['Quizzes'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '201': { description: 'Attempt started or resumed; questions are returned without correct answers' },
        '404': { description: 'Quiz not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '409': { description: 'Busy — a start for this user+quiz raced; retry shortly', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  });
  registerPath('/quizzes/attempts/{attemptId}', {
    get: {
      summary: 'Get attempt status (status, server deadline, score once submitted)',
      tags: ['Quizzes'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'attemptId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: 'Attempt status' },
        '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  });
  registerPath('/quizzes/attempts/{attemptId}/submit', {
    post: {
      summary: 'Submit answers for an attempt (idempotent; rejected past the server deadline)',
      description: 'Send an Idempotency-Key header to safely retry.',
      tags: ['Quizzes'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'attemptId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' } },
      ],
      responses: {
        '201': { description: 'Scored' },
        '200': { description: 'Already submitted — idempotent replay of the earlier result' },
        '404': { description: 'Attempt not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '409': { description: 'The deadline has passed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  });
  registerPath('/quizzes/{id}/leaderboard', {
    get: {
      summary: 'Top scores for a contest-mode quiz (Redis sorted set)',
      tags: ['Quizzes'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer', maximum: 100 } },
      ],
      responses: { '200': { description: 'Ranked entries, best score first' } },
    },
  });
}
