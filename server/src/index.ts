import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const port = 3001; // Backend läuft auf einem anderen Port als das Frontend

app.use(cors()); // CORS für Anfragen vom Frontend aktivieren
app.use(express.json()); // Middleware zum Parsen von JSON-Request-Bodies

// Pfade zu den Datendateien
const dataDir = path.join(__dirname, '..', 'data'); // Pfad zum data-Verzeichnis
const ordersFilePath = path.join(dataDir, 'orders.json');
const setupMatrixFilePath = path.join(dataDir, 'setupMatrix.json');
const cycleMatrixFilePath = path.join(dataDir, 'cycleMatrix.json');
const machinesFilePath = path.join(dataDir, 'machines.json');
const routesFilePath = path.join(dataDir, 'routes.json');
const machineGroupsFilePath = path.join(dataDir, 'machineGroups.json');

// Hilfsfunktion zum Lesen von JSON-Dateien
async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    await fs.access(filePath); // Prüfen, ob Datei existiert
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (error) {
    // Wenn Datei nicht existiert oder Fehler beim Lesen, Standardwert zurückgeben und Datei erstellen
    await fs.mkdir(path.dirname(filePath), { recursive: true }); // Sicherstellen, dass das Verzeichnis existiert
    await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2));
    return defaultValue;
  }
}

// Hilfsfunktion zum Schreiben von JSON-Dateien
async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true }); // Sicherstellen, dass das Verzeichnis existiert
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// Typdefinitionen (könnten in eine eigene Datei ausgelagert werden)
type OrderType = 'Make to Stock' | 'Make to Order';

interface ProductionOrder {
  id: number;
  name: string;
  partNumber: string;     // Teilenummer (Pflichtfeld)
  reportNumber: string;   // Rückmeldenummer (Pflichtfeld, eindeutige Kennung)
  type: OrderType;
  lotSize: number;
  dueDate: string;
}

interface Matrix {
  [from: string]: { [to: string]: number };
}

// Neue Typen für Maschinen, Maschinengruppen und Fertigungsrouten
interface MachineGroup {
  id: number;
  name: string;
  description: string;
}

interface Machine {
  id: number;
  name: string;
  description: string;
  groupId: number;               // Zugehörigkeit zu einer Maschinengruppe
  capablePartNumbers: string[];  // Liste der Teilenummern, die diese Maschine fertigen kann
}

interface ProductionRoute {
  partNumber: string;     // Teilenummer (Pflichtfeld)
  productName?: string;   // Produktname (optional)
  sequence: number[];     // Array mit Maschinengruppen-IDs in der Reihenfolge der Bearbeitung
}

// API Endpunkte für Aufträge
app.get('/api/orders', async (_req: Request, res: Response) => {
  const orders = await readJsonFile<ProductionOrder[]>(ordersFilePath, []);
  res.json(orders);
});

app.post('/api/orders', async (req: Request, res: Response) => {
  const orders = await readJsonFile<ProductionOrder[]>(ordersFilePath, []);
  const newOrder: ProductionOrder = req.body;
  newOrder.id = Date.now(); // Eindeutige ID serverseitig generieren
  orders.push(newOrder);
  await writeJsonFile(ordersFilePath, orders);
  res.status(201).json(newOrder);
});

app.delete('/api/orders/:id', async (req: Request, res: Response) => {
  const orders = await readJsonFile<ProductionOrder[]>(ordersFilePath, []);
  const orderId = parseInt(req.params.id, 10);
  const updatedOrders = orders.filter(order => order.id !== orderId);
  if (orders.length === updatedOrders.length) {
    return res.status(404).json({ message: 'Order not found' });
  }
  await writeJsonFile(ordersFilePath, updatedOrders);
  res.status(200).json({ message: 'Order deleted' });
});

// API Endpunkte für Rüstzeit-Matrix
app.get('/api/setup-matrix', async (_req: Request, res: Response) => {
  const matrix = await readJsonFile<Matrix>(setupMatrixFilePath, {});
  res.json(matrix);
});

app.post('/api/setup-matrix', async (req: Request, res: Response) => {
  const newMatrix: Matrix = req.body;
  await writeJsonFile(setupMatrixFilePath, newMatrix);
  res.status(201).json(newMatrix);
});

// API Endpunkte für Taktzeit-Matrix
app.get('/api/cycle-matrix', async (_req: Request, res: Response) => {
  const matrix = await readJsonFile<Matrix>(cycleMatrixFilePath, {});
  res.json(matrix);
});

app.post('/api/cycle-matrix', async (req: Request, res: Response) => {
  const newMatrix: Matrix = req.body;
  await writeJsonFile(cycleMatrixFilePath, newMatrix);
  res.status(201).json(newMatrix);
});

// API Endpunkte für Maschinen
app.get('/api/machines', async (_req: Request, res: Response) => {
  const machines = await readJsonFile<Machine[]>(machinesFilePath, []);
  res.json(machines);
});

app.post('/api/machines', async (req: Request, res: Response) => {
  const machines = await readJsonFile<Machine[]>(machinesFilePath, []);
  const newMachine: Machine = req.body;
  
  // Stellen Sie sicher, dass die erforderlichen Felder vorhanden sind
  if (!newMachine.groupId) {
    return res.status(400).json({ message: 'Machine group ID is required' });
  }
  
  if (!newMachine.capablePartNumbers || !Array.isArray(newMachine.capablePartNumbers)) {
    newMachine.capablePartNumbers = []; // Standardmäßig leere Liste, wenn nicht angegeben
  }
  
  // Eindeutige ID generieren - Maschinen bekommen IDs ab 1000
  newMachine.id = machines.length > 0 ? Math.max(...machines.map(m => m.id)) + 1 : 1000;
  machines.push(newMachine);
  await writeJsonFile(machinesFilePath, machines);
  res.status(201).json(newMachine);
});

app.delete('/api/machines/:id', async (req: Request, res: Response) => {
  const machines = await readJsonFile<Machine[]>(machinesFilePath, []);
  const machineId = parseInt(req.params.id, 10);
  const updatedMachines = machines.filter(machine => machine.id !== machineId);
  if (machines.length === updatedMachines.length) {
    return res.status(404).json({ message: 'Machine not found' });
  }
  await writeJsonFile(machinesFilePath, updatedMachines);
  res.status(200).json({ message: 'Machine deleted' });
});

// API Endpunkte für Fertigungsrouten
app.get('/api/routes', async (_req: Request, res: Response) => {
  const routes = await readJsonFile<ProductionRoute[]>(routesFilePath, []);
  res.json(routes);
});

app.post('/api/routes', async (req: Request, res: Response) => {
  const routes = await readJsonFile<ProductionRoute[]>(routesFilePath, []);
  const newRoute: ProductionRoute = req.body;
  
  // Prüfen, ob bereits eine Route für diese Teilenummer existiert
  const existingRouteIndex = routes.findIndex(route => route.partNumber === newRoute.partNumber);
  if (existingRouteIndex !== -1) {
    // Route aktualisieren, wenn sie bereits existiert
    routes[existingRouteIndex] = newRoute;
  } else {
    // Neue Route hinzufügen
    routes.push(newRoute);
  }
  
  await writeJsonFile(routesFilePath, routes);
  res.status(201).json(newRoute);
});

app.delete('/api/routes/:partNumber', async (req: Request, res: Response) => {
  const routes = await readJsonFile<ProductionRoute[]>(routesFilePath, []);
  const partNumber = req.params.partNumber;
  const updatedRoutes = routes.filter(route => route.partNumber !== partNumber);
  if (routes.length === updatedRoutes.length) {
    return res.status(404).json({ message: 'Route not found' });
  }
  await writeJsonFile(routesFilePath, updatedRoutes);
  res.status(200).json({ message: 'Route deleted' });
});

// API Endpunkte für Maschinengruppen
app.get('/api/machine-groups', async (_req: Request, res: Response) => {
  const machineGroups = await readJsonFile<MachineGroup[]>(machineGroupsFilePath, []);
  res.json(machineGroups);
});

app.post('/api/machine-groups', async (req: Request, res: Response) => {
  const machineGroups = await readJsonFile<MachineGroup[]>(machineGroupsFilePath, []);
  const newMachineGroup: MachineGroup = req.body;
  
  // Eindeutige ID generieren - Maschinengruppen bekommen IDs von 1-999
  const currentMaxId = machineGroups.length > 0 ? Math.max(...machineGroups.map(g => g.id)) : 0;
  // Überprüfen, ob die nächste ID noch im erlaubten Bereich für Maschinengruppen liegt
  if (currentMaxId >= 999) {
    return res.status(400).json({ message: 'Maximum number of machine groups reached (999)' });
  }
  
  newMachineGroup.id = currentMaxId + 1;
  machineGroups.push(newMachineGroup);
  await writeJsonFile(machineGroupsFilePath, machineGroups);
  res.status(201).json(newMachineGroup);
});

app.delete('/api/machine-groups/:id', async (req: Request, res: Response) => {
  const machineGroups = await readJsonFile<MachineGroup[]>(machineGroupsFilePath, []);
  const machineGroupId = parseInt(req.params.id, 10);
  
  // Prüfen, ob die Gruppe in Maschinen verwendet wird
  const machines = await readJsonFile<Machine[]>(machinesFilePath, []);
  const groupInUse = machines.some(machine => machine.groupId === machineGroupId);
  
  if (groupInUse) {
    return res.status(400).json({ message: 'Machine group is still in use by machines' });
  }
  
  const updatedMachineGroups = machineGroups.filter(group => group.id !== machineGroupId);
  if (machineGroups.length === updatedMachineGroups.length) {
    return res.status(404).json({ message: 'Machine group not found' });
  }
  
  await writeJsonFile(machineGroupsFilePath, updatedMachineGroups);
  res.status(200).json({ message: 'Machine group deleted' });
});

app.listen(port, () => {
  console.log(`Backend server is running on http://localhost:${port}`);
});
