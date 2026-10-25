import axios from 'axios';
import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export const api = axios.create({ baseURL: URL + '/api' });
api.interceptors.request.use((c) => {
  const t = localStorage.getItem('token');
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});
export const socket = io(URL, { autoConnect: false, auth: (cb) => cb({ token: localStorage.getItem('token') }) });

// Common Pune pick-up / drop points (lng, lat). Replace/extend with your own.
export const PLACES = {
  'IIIT Pune Campus': [73.7433, 18.7314],
  'Talegaon Station': [73.6769, 18.7344],
  'Pune Station': [73.8743, 18.5289],
  'Shivajinagar': [73.8478, 18.5314],
  'Pune Airport': [73.9197, 18.5793],
  'Hinjewadi': [73.7389, 18.5912],
};
export const errMsg = (e) => e.response?.data?.message || e.message;
