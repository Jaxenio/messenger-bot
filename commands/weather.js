'use strict';

const https = require('https');

const WEATHER_ICONS = {
  113: '☀️', 116: '⛅', 119: '☁️', 122: '🌫️',
  143: '🌫️', 176: '🌦️', 179: '🌨️', 182: '🌧️',
  185: '🌧️', 200: '⛈️', 227: '🌨️', 230: '❄️',
  248: '🌫️', 260: '🌫️', 263: '🌦️', 266: '🌦️',
  281: '🌧️', 284: '🌧️', 293: '🌦️', 296: '🌧️',
  299: '🌧️', 302: '🌧️', 305: '🌧️', 308: '🌧️',
  311: '🌧️', 314: '🌧️', 317: '🌧️', 320: '🌨️',
  323: '🌨️', 326: '🌨️', 329: '❄️', 332: '❄️',
  335: '❄️', 338: '❄️', 350: '🌧️', 353: '🌦️',
  356: '🌧️', 359: '🌧️', 362: '🌧️', 365: '🌧️',
  368: '🌨️', 371: '❄️', 374: '🌧️', 377: '🌧️',
  386: '⛈️', 389: '⛈️', 392: '⛈️', 395: '❄️',
};

const DIRECTION_AR = {
  N:'شمال', NNE:'شمال شمال شرق', NE:'شمال شرق', ENE:'شرق شمال شرق',
  E:'شرق', ESE:'شرق جنوب شرق', SE:'جنوب شرق', SSE:'جنوب جنوب شرق',
  S:'جنوب', SSW:'جنوب جنوب غرب', SW:'جنوب غرب', WSW:'غرب جنوب غرب',
  W:'غرب', WNW:'غرب شمال غرب', NW:'شمال غرب', NNW:'شمال شمال غرب',
};

function fetchWeather(city) {
  return new Promise((resolve, reject) => {
    const url = '/v2/?format=j1&q=' + encodeURIComponent(city) + '&lang=ar';
    https.get({ hostname: 'wttr.in', path: url, headers: { 'User-Agent': 'curl/7.88', Accept: 'application/json' }, timeout: 12000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error('تعذّر تحليل بيانات الطقس')); }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('انتهت مهلة الاتصال')); });
  });
}

module.exports = {
  name: 'weather',
  aliases: ['طقس', 'مناخ', 'w'],
  description: 'عرض حالة الطقس الحالية لأي مدينة.',
  usage: 'weather [اسم المدينة]',
  category: 'Utility',

  async execute({ api, event, args }) {
    const { threadID } = event;
    const city = args.join(' ').trim();

    if (!city) {
      return api.sendMessage(
        '🌍 الاستخدام: -weather [اسم المدينة]\n\n' +
        'أمثلة:\n' +
        '  -weather الرياض\n' +
        '  -weather Dubai\n' +
        '  -weather Cairo\n' +
        '  -weather London',
        threadID
      );
    }

    await api.sendMessage('⛅ جاري جلب بيانات الطقس لـ: ' + city + '...', threadID).catch(() => {});

    try {
      const data    = await fetchWeather(city);
      const nearest = data.nearest_area && data.nearest_area[0];
      const current = data.current_condition && data.current_condition[0];
      const today   = data.weather && data.weather[0];

      if (!current) {
        return api.sendMessage('😕 لم أجد بيانات طقس لـ: ' + city + '\nتأكد من اسم المدينة.', threadID);
      }

      const cityName = nearest
        ? (nearest.areaName[0] && nearest.areaName[0].value) + ', ' +
          (nearest.country[0] && nearest.country[0].value)
        : city;

      const tempC    = current.temp_C;
      const feelsC   = current.FeelsLikeC;
      const humidity = current.humidity;
      const windKph  = current.windspeedKmph;
      const windDir  = DIRECTION_AR[current.winddir16Point] || current.winddir16Point;
      const vis      = current.visibility;
      const pressure = current.pressure;
      const desc     = (current.lang_ar && current.lang_ar[0] && current.lang_ar[0].value) ||
                       (current.weatherDesc && current.weatherDesc[0] && current.weatherDesc[0].value) || '';
      const icon     = WEATHER_ICONS[Number(current.weatherCode)] || '🌡️';

      let maxTemp = '', minTemp = '';
      let chanceRain = '';
      if (today) {
        maxTemp    = today.maxtempC;
        minTemp    = today.mintempC;
        const hourly = today.hourly || [];
        const maxRain = Math.max(0, ...hourly.map(h => parseInt(h.chanceofrain) || 0));
        if (maxRain > 0) chanceRain = '\n🌧️ احتمال مطر: ' + maxRain + '%';
      }

      const uvIndex = current.uvIndex;
      const uvLabel = uvIndex <= 2 ? 'منخفض' : uvIndex <= 5 ? 'متوسط' : uvIndex <= 7 ? 'مرتفع' : uvIndex <= 10 ? 'مرتفع جداً' : 'خطير';

      let msg = icon + ' الطقس في ' + cityName + '\n';
      msg += '─'.repeat(28) + '\n';
      msg += '🌡️ الحرارة: ' + tempC + '°C (تشعر بـ ' + feelsC + '°C)\n';
      if (maxTemp && minTemp) msg += '🔺 أقصى: ' + maxTemp + '°C  🔻 أدنى: ' + minTemp + '°C\n';
      msg += '📝 الحالة: ' + desc + '\n';
      msg += '💧 الرطوبة: ' + humidity + '%\n';
      msg += '💨 الريح: ' + windKph + ' كم/س — ' + windDir + '\n';
      msg += '👁️ الرؤية: ' + vis + ' كم\n';
      msg += '📊 الضغط: ' + pressure + ' hPa\n';
      msg += '☀️ مؤشر UV: ' + uvIndex + ' (' + uvLabel + ')';
      msg += chanceRain;

      await api.sendMessage(msg, threadID);

    } catch (err) {
      await api.sendMessage(
        '❌ تعذّر جلب بيانات الطقس.\n' + (err.message || ''),
        threadID
      ).catch(() => {});
    }
  },
};
