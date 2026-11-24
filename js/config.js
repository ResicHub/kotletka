// App settings. Fill API_URL and GOOGLE_CLIENT_ID after setup (see README.md).
window.APP_CONFIG = {
  APP_NAME: 'Kotletka',
  API_URL: 'https://script.google.com/macros/s/AKfycbyMsxa1kE0YlV5YJjE-m_bnvRUi8hwPFe2Ye-ENPCLuj3Fk7lwkUMCj_xfU08eL6GOI/exec',            // Apps Script web app URL, ends with /exec
  GOOGLE_CLIENT_ID: '24586340664-q5g745dadhlhpm7r8qojpo2h8qlglcf1.apps.googleusercontent.com',   // xxxxx.apps.googleusercontent.com
  CITY_CENTER: [56.0106, 92.8710], // Krasnoyarsk
  CITY_ZOOM: 13,
  CURRENCY: '₽',
  CARTO_KEY: '',          // optional: free key from carto.com/basemaps/apikey for a nicer map style; empty = OpenStreetMap tiles
};
