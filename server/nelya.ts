import { randomInt } from 'node:crypto';
export function nelyaReply(body: string): string | null {
  const command = body.trim();
  if (!/^(@неля|\/неля|\/nelya)(\s|$)/iu.test(command)) return null;
  const text = command.replace(/^\S+\s*/u, '').trim();
  if (/^(монетка|coin)$/iu.test(text))
    return `Выпало: ${randomInt(2) ? 'орёл' : 'решка'}! Решение за вами.`;
  if (/^(выбери|choose)\s/iu.test(text)) {
    const options = text
      .replace(/^\S+\s*/u, '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    return options.length > 1
      ? `Я выбираю: ${options[randomInt(options.length)]}`
      : 'Напишите так: @неля выбери пицца | суши | паста';
  }
  if (/^(идея|idea)$/iu.test(text))
    return [
      'Устройте вечер настольных игр. Каждый приносит одну игру и что-нибудь к чаю.',
      'Прогулка по незнакомому району: по очереди выбирайте, куда повернуть.',
      'Киновечер: каждый предлагает фильм, а я могу выбрать через «@неля выбери».',
      'Приготовьте ужин вместе. Каждый отвечает за один ингредиент.',
    ][randomInt(4)];
  return 'Я Неля, маленький помощник вашей компании. Пока без ИИ, зато без лишних сложностей.\n\n@неля монетка — орёл или решка\n@неля выбери пицца | суши — выберу вариант\n@неля идея — предложу занятие\n@неля помощь — покажу команды';
}
