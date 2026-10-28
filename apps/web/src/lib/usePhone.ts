import { useEffect, useState } from 'react';
import { PHONE } from './breakpoints';

/** Whether the page has the phone layout (one column: 3D view, then the settings). */
export function usePhone() {
  const [phone, setPhone] = useState(() => typeof matchMedia === 'function' && matchMedia(PHONE).matches);
  useEffect(() => {
    const q = matchMedia(PHONE);
    const on = () => setPhone(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return phone;
}
