'use strict';

// حاسبة آمنة — تسمح فقط بالعمليات الرياضية دون تنفيذ كود JS
const ALLOWED = /^[\d\s\+\-\*\/\%\^\(\)\.\,eE]+$/;

function safeEval(expr) {
  // تنظيف: استبدال ^ بـ ** وإزالة المسافات الزائدة
  const clean = expr
    .replace(/\^/g, '**')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)) // أرقام عربية
    .replace(/،/g, ',')
    .trim();

  if (!ALLOWED.test(clean.replace(/\*\*/g, ''))) {
    throw new Error('تعبير غير مسموح به');
  }

  // eslint-disable-next-line no-new-func
  const result = Function('"use strict"; return (' + clean + ')')();

  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error('نتيجة غير صالحة');
  }

  return result;
}

function formatNumber(n) {
  if (Number.isInteger(n)) return n.toLocaleString('en');
  return parseFloat(n.toPrecision(10)).toString();
}

module.exports = {
  name: 'calc',
  aliases: ['حاسبة', 'calculate', 'math', 'حساب'],
  description: 'حاسبة رياضية تدعم العمليات الأساسية والمتقدمة.',
  usage: 'calc [عملية حسابية]',
  category: 'Utility',

  async execute({ api, event, args }) {
    const { threadID } = event;
    const expr = args.join(' ').trim();

    if (!expr) {
      return api.sendMessage(
        '🧮 الاستخدام: -calc [عملية حسابية]\n\n' +
        'أمثلة:\n' +
        '  -calc 2 + 2\n' +
        '  -calc 15 * 7\n' +
        '  -calc (100 + 50) / 3\n' +
        '  -calc 2 ^ 10\n' +
        '  -calc 150 % 7\n\n' +
        'العمليات المدعومة: + - * / % ^ ()',
        threadID
      );
    }

    try {
      const result = safeEval(expr);
      const formatted = formatNumber(result);

      await api.sendMessage(
        '🧮 ' + expr.replace(/\*\*/g, '^') + '\n' +
        '─'.repeat(20) + '\n' +
        '= ' + formatted,
        threadID
      );
    } catch (err) {
      await api.sendMessage(
        '❌ خطأ في الحساب: ' + (err.message || 'تعبير غير صالح') + '\n' +
        'مثال صحيح: -calc (25 * 4) + 100',
        threadID
      );
    }
  },
};
