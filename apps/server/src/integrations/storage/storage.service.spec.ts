import { TestingModule } from '@nestjs/testing';
import { Readable } from 'node:stream';
import { StorageService } from './storage.service';
import { STORAGE_DRIVER_TOKEN } from './constants/storage.constants';
import { createUnitModule } from '../../test-support/unit-module';

describe('StorageService', () => {
  let module: TestingModule, service: StorageService;
  let driver: Record<string, jest.Mock>;
  beforeEach(async () => {
    driver = Object.fromEntries(
      [
        'upload',
        'uploadStream',
        'copy',
        'read',
        'readStream',
        'readRangeStream',
        'exists',
        'getSignedUrl',
        'getUrl',
        'delete',
        'getDriverName',
      ].map((name) => [name, jest.fn()]),
    );
    module = await createUnitModule(StorageService, [
      [STORAGE_DRIVER_TOKEN, driver],
    ]);
    service = module.get(StorageService);
  });
  afterEach(async () => {
    await module?.close();
  });
  it('should be defined', () => expect(service).toBeDefined());
  it('passes binary contents to the configured storage driver without alteration', async () => {
    const bytes = Buffer.from('中文附件');
    await service.upload('workspace/file', bytes);
    expect(driver.upload).toHaveBeenCalledWith('workspace/file', bytes);
    driver.read.mockResolvedValue(bytes);
    expect(await service.read('workspace/file')).toBe(bytes);
  });
  it('preserves stream identity and retry options', async () => {
    const stream = Readable.from(['attachment']);
    const options = { recreateClient: true };
    await service.uploadStream('file', stream, options);
    expect(driver.uploadStream).toHaveBeenCalledWith('file', stream, options);
    driver.readStream.mockResolvedValue(stream);
    expect(await service.readStream('file')).toBe(stream);
  });
  it('passes exact requested byte ranges', async () => {
    const stream = Readable.from(['part']);
    driver.readRangeStream.mockResolvedValue(stream);
    expect(await service.readRangeStream('file', { start: 4, end: 8 })).toBe(
      stream,
    );
    expect(driver.readRangeStream).toHaveBeenCalledWith('file', {
      start: 4,
      end: 8,
    });
  });
  it('delegates copying, existence and signed-url lifetimes', async () => {
    await service.copy('old', 'new');
    expect(driver.copy).toHaveBeenCalledWith('old', 'new');
    driver.exists.mockResolvedValue(false);
    expect(await service.exists('missing')).toBe(false);
    driver.getSignedUrl.mockResolvedValue('https://files.example.invalid/test');
    expect(await service.getSignedUrl('file', 60)).toBe(
      'https://files.example.invalid/test',
    );
    expect(driver.getSignedUrl).toHaveBeenCalledWith('file', 60);
    driver.getUrl.mockReturnValue('/file');
    expect(service.getUrl('file')).toBe('/file');
    driver.getDriverName.mockReturnValue('local');
    expect(service.getDriverName()).toBe('local');
  });
  it('propagates upload, read and deletion failures instead of claiming success', async () => {
    const error = new Error('storage unavailable');
    driver.upload.mockRejectedValue(error);
    driver.read.mockRejectedValue(error);
    driver.delete.mockRejectedValue(error);
    await expect(service.upload('file', Buffer.alloc(0))).rejects.toBe(error);
    await expect(service.read('file')).rejects.toBe(error);
    await expect(service.delete('file')).rejects.toBe(error);
  });
});
