// Live weather from Open-Meteo: free, no key, and called straight from the
// phone, so it is always current rather than whatever it was at 7:49am.

const CODES = {
  0: ['Clear', '☀️', '🌙'],
  1: ['Mostly clear', '🌤️', '🌙'],
  2: ['Partly cloudy', '⛅', '☁️'],
  3: ['Cloudy', '☁️', '☁️'],
  45: ['Fog', '🌫️', '🌫️'],
  48: ['Freezing fog', '🌫️', '🌫️'],
  51: ['Light drizzle', '🌦️', '🌧️'],
  53: ['Drizzle', '🌦️', '🌧️'],
  55: ['Heavy drizzle', '🌧️', '🌧️'],
  56: ['Freezing drizzle', '🌧️', '🌧️'],
  57: ['Freezing drizzle', '🌧️', '🌧️'],
  61: ['Light rain', '🌦️', '🌧️'],
  63: ['Rain', '🌧️', '🌧️'],
  65: ['Heavy rain', '🌧️', '🌧️'],
  66: ['Freezing rain', '🌧️', '🌧️'],
  67: ['Freezing rain', '🌧️', '🌧️'],
  71: ['Light snow', '🌨️', '🌨️'],
  73: ['Snow', '🌨️', '🌨️'],
  75: ['Heavy snow', '❄️', '❄️'],
  77: ['Snow grains', '🌨️', '🌨️'],
  80: ['Showers', '🌦️', '🌧️'],
  81: ['Showers', '🌧️', '🌧️'],
  82: ['Heavy showers', '🌧️', '🌧️'],
  85: ['Snow showers', '🌨️', '🌨️'],
  86: ['Snow showers', '🌨️', '🌨️'],
  95: ['Thunderstorms', '⛈️', '⛈️'],
  96: ['Thunderstorms, hail', '⛈️', '⛈️'],
  99: ['Thunderstorms, hail', '⛈️', '⛈️'],
};

export function describe(code, isDay = true) {
  const [label, day, night] = CODES[code] || ['', '🌡️', '🌡️'];
  return { label, icon: isDay ? day : night };
}

export async function forecast({ latitude, longitude }) {
  const params = new URLSearchParams({
    latitude,
    longitude,
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunset',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    forecast_days: '2',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error('Weather is unavailable right now.');
  const data = await response.json();

  // Hourly times are local to the place; start from the current hour.
  const nowHour = data.current.time.slice(0, 13);
  const start = Math.max(0, data.hourly.time.findIndex((t) => t.slice(0, 13) >= nowHour));
  const hours = [];
  for (let i = start + 1; i < data.hourly.time.length && hours.length < 6; i += 2) {
    hours.push({
      time: data.hourly.time[i],
      temp: Math.round(data.hourly.temperature_2m[i]),
      rain: data.hourly.precipitation_probability[i],
      ...describe(data.hourly.weather_code[i], data.hourly.is_day[i] === 1),
    });
  }

  return {
    temp: Math.round(data.current.temperature_2m),
    feels: Math.round(data.current.apparent_temperature),
    wind: Math.round(data.current.wind_speed_10m),
    ...describe(data.current.weather_code, data.current.is_day === 1),
    high: Math.round(data.daily.temperature_2m_max[0]),
    low: Math.round(data.daily.temperature_2m_min[0]),
    rain: data.daily.precipitation_probability_max[0],
    sunset: data.daily.sunset[0],
    hours,
  };
}

/** Look a place up by name: "Las Vegas", "92101", "Fort Hood". */
export async function findPlace(query) {
  const params = new URLSearchParams({ name: query, count: '1', language: 'en', format: 'json' });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!response.ok) throw new Error('Could not look that place up.');
  const data = await response.json();
  const place = data.results && data.results[0];
  if (!place) throw new Error(`No place called "${query}" found.`);
  const region = place.admin1 && place.admin1 !== place.name ? `, ${place.admin1}` : '';
  return { latitude: place.latitude, longitude: place.longitude, name: `${place.name}${region}` };
}

export function hereNow() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This phone cannot share its location here. Type a city instead.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: Math.round(position.coords.latitude * 100) / 100,
        longitude: Math.round(position.coords.longitude * 100) / 100,
        name: 'Your location',
      }),
      () => reject(new Error('Location was not shared. Type a city instead.')),
      { timeout: 10000, maximumAge: 30 * 60 * 1000 },
    );
  });
}
