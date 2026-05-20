import { expect, test, type Page } from '@playwright/test';

const demoUsers = {
  cliente: { email: 'cliente@conectapro.mx', password: 'Demo123!' },
  proveedor: { email: 'proveedor@conectapro.mx', password: 'Demo123!' },
  admin: { email: 'admin@conectapro.mx', password: 'Demo123!' }
} as const;

async function login(page: Page, role: keyof typeof demoUsers) {
  await page.goto('/');
  await page.getByLabel(/Selecciona rol/i).getByRole('button', { name: new RegExp(role, 'i') }).click();
  await page.locator('input[type="email"]').fill(demoUsers[role].email);
  await page.locator('input[type="password"]').fill(demoUsers[role].password);
  await page.locator('button[type="submit"]').click();
}

async function logout(page: Page) {
  await page.getByLabel(/Cerrar sesion/i).click();
  await expect(page.getByText(/Sin sesion/i)).toBeVisible();
}

test('catalogo y mapa publico cargan desde Firebase sin sesion', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'App Proveedores' })).toBeVisible();
  await page.getByRole('button', { name: 'Catalogo', exact: true }).click();
  await expect(page.locator('.category-card')).toHaveCount(8);

  await page.getByRole('button', { name: /Mapa/i }).click();
  await expect(page.locator('.osm-map, .mapbox-map')).toBeVisible();
  await expect(page.locator('.osm-marker, .mapbox-marker')).toHaveCount(5);
  await expect(page.getByText(/permission-denied/i)).toHaveCount(0);
});

test('los tres roles demo inician sesion y ven su dashboard', async ({ page }) => {
  await login(page, 'cliente');
  await expect(page.getByRole('heading', { name: /Publica solicitudes/i })).toBeVisible();
  await logout(page);

  await login(page, 'proveedor');
  await expect(page.getByRole('heading', { name: 'Solicitudes abiertas', exact: true })).toBeVisible();
  await logout(page);

  await login(page, 'admin');
  await expect(page.getByRole('heading', { name: /Operacion, verificacion y disputas/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Verificar proveedores/i })).toBeVisible();
});

test('cliente crea solicitud y proveedor la puede cotizar', async ({ page }) => {
  const title = `E2E chapa Firebase ${Date.now()}`;

  await login(page, 'cliente');
  await page.getByLabel(/Titulo del trabajo/i).fill(title);
  await page.getByLabel(/Categoria/i).selectOption('cerrajeria');
  await page.getByLabel(/Direccion/i).fill('Roma Norte, Cuauhtemoc');
  await page.getByLabel(/Presupuesto MXN/i).fill('1300');
  await page.getByLabel(/Detalles/i).fill('Prueba E2E de produccion para validar solicitud real en Firebase.');
  await page.getByRole('button', { name: /Publicar solicitud/i }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await logout(page);

  await login(page, 'proveedor');
  await expect(page.getByText(title)).toBeVisible();
  const requestCard = page.locator('.request-card').filter({ hasText: title });
  await requestCard.getByRole('button', { name: /Cotizar/i }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.locator('.pill').filter({ hasText: 'Cotizada' })).toBeVisible();
});
