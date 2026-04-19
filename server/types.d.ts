declare module "multer";
declare module "adm-zip";

declare namespace Express {
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
  }

  interface Request {
    file?: MulterFile;
    files?: MulterFile[] | Record<string, MulterFile[]>;
  }
}
