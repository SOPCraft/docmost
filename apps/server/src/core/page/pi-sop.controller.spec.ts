import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { PiSopController } from './pi-sop.controller';
import { REQUIRE_SESSION_AUTH_KEY } from '../../common/decorators/require-session-auth.decorator';

// Controller unit tests; no listening server, authentication session, database or model.
function fixture() {
  const requestRaw = Object.assign(new EventEmitter(), { aborted: false });
  const replyRaw = Object.assign(new EventEmitter(), { writableEnded: false });
  const service = { status: jest.fn(), prepare: jest.fn(), revalidate: jest.fn(), generate: jest.fn() };
  return { controller: new PiSopController(service as any), service,
    request: { raw: requestRaw } as any, response: { raw: replyRaw } as any };
}

it('requires session authentication for the entire controller', () => {
  expect(Reflect.getMetadata(REQUIRE_SESSION_AUTH_KEY, PiSopController)).toBe(true);
  expect(Reflect.getMetadata('__guards__', PiSopController)).toHaveLength(1);
});
it('does not cache authenticated status, source or preview responses', () => {
  for (const method of ['status', 'prepare', 'revalidate', 'generate']) {
    expect(Reflect.getMetadata('__headers__', PiSopController.prototype[method])).toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
  }
});
it('forwards authenticated status and preparation to the existing service', () => {
  const f = fixture(); const user = { id: 'fixture' } as any;
  const body = { pageIds: ['synthetic'] };
  f.controller.status({ pageId: 'synthetic' }, user); f.controller.prepare(body, user);
  expect(f.service.status).toHaveBeenCalledWith('synthetic', user);
  expect(f.service.prepare).toHaveBeenCalledWith(body, user);
});
it('cleans up request listeners after successful generation', async () => {
  const f = fixture(); f.service.generate.mockResolvedValue({ saved: false });
  await expect(f.controller.generate({} as any, {} as any, f.request, f.response)).resolves.toEqual({ saved: false });
  expect(f.request.raw.listenerCount('aborted')).toBe(0);
  expect(f.response.raw.listenerCount('close')).toBe(0);
});
it('aborts disconnected requests and never returns a late result', async () => {
  const f = fixture(); let resolve!: (value: unknown) => void;
  f.service.generate.mockImplementation(() => new Promise(done => { resolve = done; }));
  const result = f.controller.generate({} as any, {} as any, f.request, f.response);
  const rejected = expect(result).rejects.toThrow('PI_CANCELLED');
  f.response.raw.emit('close'); await rejected;
  expect(f.service.generate.mock.calls[0][2].aborted).toBe(true);
  resolve({ saved: false });
  expect(f.request.raw.listenerCount('aborted')).toBe(0);
});
it('bounds the HTTP request even when a service never settles', async () => {
  jest.useFakeTimers();
  try {
    const f = fixture(); f.service.generate.mockImplementation(() => new Promise(() => {}));
    const result = f.controller.generate({} as any, {} as any, f.request, f.response);
    const rejected = expect(result).rejects.toThrow('PI_TIMEOUT');
    jest.advanceTimersByTime(65000); await rejected;
    expect(f.service.generate.mock.calls[0][2].aborted).toBe(true);
    expect(f.response.raw.listenerCount('close')).toBe(0);
  } finally { jest.useRealTimers(); }
});
