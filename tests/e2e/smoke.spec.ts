import { expect, test } from '@playwright/test';

test('home y creación de solicitud cliente', async ({ page }) => {
  const title = `Cambio urgente de chapa principal ${Date.now()}`;
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'ConectaPro' })).toBeVisible();
  await page.getByRole('button', { name: 'Legal y confianza' }).click();
  await expect(page.getByRole('heading', { name: /Reglas claras/i })).toBeVisible();
  await page.getByRole('button', { name: /Inicio/i }).click();
  await page.getByLabel(/Selecciona rol/i).getByRole('button', { name: 'Cliente' }).click();
  await page.getByRole('button', { name: 'Enviar formulario para entrar' }).click();
  await expect(page.getByRole('heading', { name: /Publica solicitudes/i })).toBeVisible();

  await page.getByLabel(/Título del trabajo/i).fill(title);
  await page.getByLabel(/Categoría/i).selectOption('cerrajeria');
  await page.getByLabel(/Dirección/i).fill('Roma Norte, Cuauhtemoc');
  await page.getByLabel(/Presupuesto MXN/i).fill('1300');
  await page.getByLabel(/Detalles/i).fill('La chapa está barrida y necesito reemplazo hoy por la tarde.');
  await page.getByRole('button', { name: /Publicar solicitud/i }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});

test('proveedor ve solicitudes abiertas con suscripción', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Proveedor' }).click();
  await page.getByRole('button', { name: 'Enviar formulario para entrar' }).click();

  await expect(page.getByRole('heading', { name: 'Solicitudes abiertas', exact: true })).toBeVisible();
  await expect(page.getByText(/Plan Pro/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Aplicar filtros/i })).toBeVisible();
});
