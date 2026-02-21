export class CodeledgerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodeledgerError";
  }
}

export class WatcherError extends CodeledgerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WatcherError";
  }
}

export class ParseError extends CodeledgerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ParseError";
  }
}

export class ExtractError extends CodeledgerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExtractError";
  }
}

export class IndexError extends CodeledgerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IndexError";
  }
}

export class StoreError extends CodeledgerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StoreError";
  }
}

export class SearchError extends CodeledgerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SearchError";
  }
}