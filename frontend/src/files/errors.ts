import { ApiError } from "../lib/api";

const TEXT: Record<string, string> = {
  unauthorized: "Нужно войти заново",
  forbidden: "Доступ закрыт",
  not_found: "Файл или папка не найдены",
  exists: "Такое имя уже есть",
  quota_exceeded: "Не хватает места в квоте",
  invalid_path: "Недопустимый путь или имя",
  invalid_request: "Некорректный запрос",
  conflict: "Файл изменён другим пользователем",
  invalid_encoding: "Файл не в кодировке UTF-8",
  internal: "Ошибка сервера",
};

export function describeFileError(err: unknown): string {
  if (err instanceof ApiError && err.code && Object.prototype.hasOwnProperty.call(TEXT, err.code)) {
    return TEXT[err.code];
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Не удалось выполнить действие";
}