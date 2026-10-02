import { CanActivate, InjectionToken, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';

/**
 * Method-level unit test container. Dependencies are explicit, never auto-mocked.
 * HTTP guards are deliberately not exercised by direct method calls. Listed
 * guard stand-ins throw if invoked, so this helper cannot fake an allowed HTTP request.
 * Transport authorization is covered separately by guard metadata and live HTTP tests.
 */
export async function createUnitModule<T>(
  subject: Type<T>,
  dependencies: Array<[InjectionToken, unknown]>,
  transportGuards: Array<Type<CanActivate>> = [],
) {
  const builder = Test.createTestingModule({
    controllers: transportGuards.length ? [subject] : [],
    providers: [
      ...(transportGuards.length ? [] : [subject]),
      ...dependencies.map(([provide, useValue]) => ({ provide, useValue })),
    ],
  });
  for (const guard of transportGuards) {
    builder.overrideGuard(guard).useValue({
      canActivate() {
        throw new Error(
          'HTTP transport is not configured in this method-level unit test',
        );
      },
    });
  }
  return builder.compile();
}
