from __future__ import annotations


class APIError(Exception):
    """An error that is safe to return as the API's standard error body."""

    def __init__(self, code: str, status_code: int, message: str):
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.message = message
