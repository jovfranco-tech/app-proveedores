import { expect, test } from '@playwright/test';

test('home y creacion de solicitud cliente', async ({ page }) => {
  const title = `Cambio urgente de chapa principal ${Date.now()}`;
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'App Proveedores' })).toBeVisible();
  await page.getByRole('button', { name: /Cliente/i }).first().click();
  await expect(page.getByRole('heading', { name: /Publica solicitudes/i })).toBeVisible();

  await page.getByLabel(/Titulo del trabajo/i).fill(title);
  await page.getByLabel(/Categoria/i).selectOption('cerrajeria');
  await page.getByLabel(/Direccion/i).fill('Roma Norte, Cuauhtemoc');
  await page.getByLabel(/Presupuesto MXN/i).fill('1300');
  await page.getByLabel(/Detalles/i).fill('La chapa esta barrida y necesito reemplazo hoy por la tarde.');
  await page.getByRole('button', { name: /Publicar solicitud/i }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});

test('proveedor ve solicitudes abiertas con suscripcion', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Proveedor' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByRole('heading', { name: 'Solicitudes abiertas', exact: true })).toBeVisible();
  await expect(page.getByText(/Plan Pro/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Aplicar filtros/i })).toBeVisible();
});
