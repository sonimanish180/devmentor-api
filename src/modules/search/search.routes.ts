import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { cacheControl } from '../../middleware/cacheControl';
import { searchQuery } from './search.schema';
import * as searchController from './search.controller';
import { registerSearchOpenApi } from './search.openapi';

export const searchRouter = Router();

searchRouter.get('/', cacheControl(30), validate({ query: searchQuery }), searchController.search);

registerSearchOpenApi();
