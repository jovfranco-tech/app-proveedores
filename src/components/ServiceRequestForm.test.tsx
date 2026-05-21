import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ServiceRequestForm } from './ServiceRequestForm';
import type { Category } from '../types';

const categories: Category[] = [
  {
    id: 'cerrajeria',
    name: 'Cerrajería',
    slug: 'cerrajeria',
    description: 'Aperturas, cambios de chapa y emergencias 24/7.',
    image: '/assets/category-cerrajeria.webp',
    accent: '#0d9488',
    averagePrice: 850,
    emergency: true,
    featured: true
  },
  {
    id: 'cctv',
    name: 'Instalación CCTV',
    slug: 'cctv',
    description: 'Cámaras y configuración remota.',
    image: '/assets/category-cctv.webp',
    accent: '#7c3aed',
    averagePrice: 4200,
    emergency: false,
    featured: true
  }
];

describe('ServiceRequestForm', () => {
  it('emite un payload válido para publicar una solicitud crítica', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(<ServiceRequestForm categories={categories} clientId="usr_cliente_1" onCreate={onCreate} />);

    await user.type(screen.getByLabelText(/Título del trabajo/i), 'Cambio de chapa principal');
    await user.selectOptions(screen.getByLabelText(/Categoría/i), 'cctv');
    await user.clear(screen.getByLabelText(/Presupuesto MXN/i));
    await user.type(screen.getByLabelText(/Presupuesto MXN/i), '5200');
    await user.type(screen.getByLabelText(/Dirección/i), 'Narvarte Poniente, Benito Juarez');
    await user.type(screen.getByLabelText(/Detalles/i), 'Instalar cuatro cámaras con acceso remoto desde celular.');
    await user.click(screen.getByRole('button', { name: /Publicar solicitud/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'usr_cliente_1',
        title: 'Cambio de chapa principal',
        categoryId: 'cctv',
        budget: 5200,
        address: 'Narvarte Poniente, Benito Juarez'
      })
    );
  });
});
