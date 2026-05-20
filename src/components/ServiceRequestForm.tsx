import { CalendarClock, LocateFixed, MapPin, SendHorizontal } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CreateRequestPayload } from '../api';
import type { Category } from '../types';

interface ServiceRequestFormProps {
  categories: Category[];
  clientId: string;
  busy?: boolean;
  onCreate: (payload: CreateRequestPayload) => Promise<void> | void;
}

const defaultDateTime = () => {
  const date = new Date();
  date.setHours(date.getHours() + 4);
  date.setMinutes(0, 0, 0);
  return date.toISOString().slice(0, 16);
};

export function ServiceRequestForm({ categories, clientId, busy = false, onCreate }: ServiceRequestFormProps) {
  const firstCategory = categories[0]?.id ?? '';
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState(firstCategory);
  const [dateTime, setDateTime] = useState(defaultDateTime);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Ciudad de Mexico');
  const [budget, setBudget] = useState(1200);
  const [description, setDescription] = useState('');
  const [useLocation, setUseLocation] = useState(true);

  const category = useMemo(() => categories.find((item) => item.id === categoryId), [categories, categoryId]);

  useEffect(() => {
    if (!categoryId && categories[0]) {
      setCategoryId(categories[0].id);
      setBudget(categories[0].averagePrice);
    }
  }, [categories, categoryId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onCreate({
      clientId,
      title,
      categoryId,
      address,
      city,
      dateTime,
      budget,
      description,
      location: useLocation ? { lat: 19.4328, lng: -99.1333 } : undefined
    });
    setTitle('');
    setAddress('');
    setDescription('');
    setBudget(category?.averagePrice ?? 1200);
  }

  return (
    <form className="request-form" aria-label="Crear solicitud de servicio" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label>
          Titulo del trabajo
          <input
            required
            minLength={8}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Cambio de chapa principal"
          />
        </label>
        <label>
          Categoria
          <select
            required
            value={categoryId}
            onChange={(event) => {
              const nextCategory = categories.find((item) => item.id === event.target.value);
              setCategoryId(event.target.value);
              if (nextCategory) setBudget(nextCategory.averagePrice);
            }}
          >
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fecha y hora
          <span className="input-icon">
            <CalendarClock aria-hidden="true" size={18} />
            <input required type="datetime-local" value={dateTime} onChange={(event) => setDateTime(event.target.value)} />
          </span>
        </label>
        <label>
          Presupuesto MXN
          <input
            required
            min={200}
            step={50}
            type="number"
            value={budget}
            onChange={(event) => setBudget(Number(event.target.value))}
          />
        </label>
        <label className="span-2">
          Direccion
          <span className="input-icon">
            <MapPin aria-hidden="true" size={18} />
            <input
              required
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Colonia, alcaldia o referencia"
            />
          </span>
        </label>
        <label>
          Ciudad
          <input required value={city} onChange={(event) => setCity(event.target.value)} />
        </label>
        <label className="toggle-field">
          <input type="checkbox" checked={useLocation} onChange={(event) => setUseLocation(event.target.checked)} />
          <span>
            <LocateFixed aria-hidden="true" size={18} />
            Adjuntar ubicacion aproximada
          </span>
        </label>
        <label className="span-2">
          Detalles
          <textarea
            required
            minLength={15}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe materiales, acceso, urgencia o fotos que compartiras en el chat."
          />
        </label>
      </div>
      <div className="form-footer">
        <p aria-live="polite">
          {category ? `Promedio de ${category.name}: ${new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(category.averagePrice)}` : 'Selecciona una categoria'}
        </p>
        <button className="primary-button" disabled={busy || !categories.length} type="submit">
          <SendHorizontal aria-hidden="true" size={18} />
          Publicar solicitud
        </button>
      </div>
    </form>
  );
}
