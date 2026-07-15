import path from 'node:path';
import express, { type RequestHandler, type Router } from 'express';

const IMMUTABLE_ASSET_MAX_AGE = '1y';

export const apiCachePolicy: RequestHandler = (_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
};

export const apiNotFound: RequestHandler = (_request, response) => {
  response.status(404).json({ error: 'api_not_found' });
};

export const resourceNotFound: RequestHandler = (_request, response) => {
  sendPlainNotFound(response);
};

export function createWebRouter(webRoot: string): Router {
  const router = express.Router();
  const assetsRoot = path.join(webRoot, 'assets');

  router.use('/assets', express.static(assetsRoot, {
    immutable: true,
    index: false,
    maxAge: IMMUTABLE_ASSET_MAX_AGE,
    redirect: false
  }));
  router.use('/assets', resourceNotFound);

  router.use(express.static(webRoot, {
    index: false,
    redirect: false,
    setHeaders(response) {
      response.setHeader('Cache-Control', 'no-cache');
    }
  }));

  router.get('/{*splat}', (request, response, next) => {
    if (path.posix.extname(request.path) || !request.accepts('html')) {
      next();
      return;
    }
    response.sendFile(path.join(webRoot, 'index.html'), {
      headers: { 'Cache-Control': 'no-cache' }
    }, next);
  });

  router.use(resourceNotFound);
  return router;
}

function sendPlainNotFound(response: Parameters<RequestHandler>[1]): void {
  response.status(404).set('Cache-Control', 'no-store').type('text/plain').send('Not Found');
}
