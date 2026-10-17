declare module "connect-pg-simple" {
  import type session from "express-session";
  type SessionStoreFactory = (sessionModule: typeof session) => new (options?: {
    conString?: string;
    createTableIfMissing?: boolean;
    tableName?: string;
  }) => session.Store;
  const connectPgSimple: SessionStoreFactory;
  export default connectPgSimple;
}
