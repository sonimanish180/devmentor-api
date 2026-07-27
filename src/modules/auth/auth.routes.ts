import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/requireAuth';
import { registerBody, loginBody } from './auth.schema';
import * as authController from './auth.controller';
import { registerAuthOpenApi } from './auth.openapi';

export const authRouter = Router();

authRouter.post('/register', validate({ body: registerBody }), authController.register);
authRouter.post('/login', validate({ body: loginBody }), authController.login);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.get('/me', requireAuth, authController.me);

registerAuthOpenApi();
