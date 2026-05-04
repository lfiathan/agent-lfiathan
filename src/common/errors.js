export class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {string} code
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends AppError {
  /** @param {string} resource */
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  /** @param {string} message */
  constructor(message = 'Validation failed') {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class ConflictError extends AppError {
  /** @param {string} message */
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
  }
}

export class HermesUnavailableError extends AppError {
  /** @param {string} [message] */
  constructor(message = 'Hermes agent is currently unavailable') {
    super(message, 503, 'HERMES_UNAVAILABLE');
  }
}
