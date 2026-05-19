declare module 'connect-sqlite3' {
  import session from 'express-session';

  type SQLiteStoreOptions = {
    dir?: string;
    db?: string;
    table?: string;
  };

  function SQLiteStoreFactory(expressSession: typeof session): {
    new (options?: SQLiteStoreOptions): session.Store;
  };

  export default SQLiteStoreFactory;
}

