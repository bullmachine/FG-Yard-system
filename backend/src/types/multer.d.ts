/**
 * Minimal ambient types for multer 2.x.
 *
 * multer ships no bundled declarations and @types/multer could not be fetched from
 * the registry here, so only the surface actually used by this app is declared.
 * Replacing this file with `npm i -D @types/multer` is safe and preferred once the
 * registry is reachable.
 */
declare module 'multer' {
  import type { Request, RequestHandler } from 'express';

  /** `multer(opts)` returns the instance you then call `.single()` on. */
  function multer(options?: multer.Options): multer.Multer;

  namespace multer {
    type Callback<T> = (error: Error | null, result?: T) => void;

    interface MulterFile {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size: number;
      destination: string;
      filename: string;
      path: string;
      buffer: Buffer;
      stream: NodeJS.ReadableStream;
    }

    type MulterRequest = Request & { file?: MulterFile };

    interface DiskStorageOptions {
      destination?:
        | string
        | ((req: MulterRequest, file: MulterFile, cb: Callback<string>) => void);
      filename?: (req: MulterRequest, file: MulterFile, cb: Callback<string>) => void;
    }

    interface StorageEngine {
      _handleFile(req: MulterRequest, file: MulterFile, cb: Callback<unknown>): void;
      _removeFile(req: MulterRequest, file: MulterFile, cb: Callback<unknown>): void;
    }

    interface Options {
      storage?: StorageEngine;
      dest?: string;
      limits?: {
        fieldNameSize?: number;
        fieldSize?: number;
        fields?: number;
        fileSize?: number;
        files?: number;
        parts?: number;
        headerPairs?: number;
      };
      preservePath?: boolean;
      fileFilter?: (
        req: MulterRequest,
        file: MulterFile,
        cb: (error: Error | null, acceptFile: boolean) => void
      ) => void;
    }

    interface Multer {
      single(fieldname: string): RequestHandler;
      array(fieldname: string, maxCount?: number): RequestHandler;
      fields(fields: Array<{ name: string; maxCount?: number }>): RequestHandler;
      none(): RequestHandler;
      any(): RequestHandler;
    }

    function diskStorage(options?: DiskStorageOptions): StorageEngine;
    function memoryStorage(): StorageEngine;
  }

  export = multer;
}
