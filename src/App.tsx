import { useState } from 'react'
import './App.css'

// Typen für Aufträge und Matrizen
type OrderType = 'Make to Stock' | 'Make to Order';

interface ProductionOrder {
  id: number;
  type: OrderType;
  lotSize: number;
  dueDate: string;
}

interface Matrix {
  [from: string]: { [to: string]: number };
}

function App() {
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [lotSize, setLotSize] = useState(1);
  const [dueDate, setDueDate] = useState('');
  const [orderType, setOrderType] = useState<OrderType>('Make to Stock');
  const [setupMatrix, setSetupMatrix] = useState<Matrix>({});
  const [cycleMatrix, setCycleMatrix] = useState<Matrix>({});

  // Auftrag hinzufügen
  const addOrder = () => {
    if (!dueDate) return;
    setOrders([
      ...orders,
      {
        id: Date.now(),
        type: orderType,
        lotSize,
        dueDate,
      },
    ]);
    setLotSize(1);
    setDueDate('');
    setOrderType('Make to Stock');
  };

  // Matrix-Import (CSV-Format)
  const handleMatrixUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    setMatrix: (m: Matrix) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const header = lines[0].split(',').map((h) => h.trim());
      const matrix: Matrix = {};
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map((p) => p.trim());
        const from = parts[0];
        matrix[from] = {};
        for (let j = 1; j < parts.length; j++) {
          matrix[from][header[j]] = Number(parts[j]);
        }
      }
      setMatrix(matrix);
    };
    reader.readAsText(file);
  };

  return (
    <div className="container">
      <h1>Reihenfolgeplanung Fließfertigung</h1>
      <section>
        <h2>Auftrag erfassen</h2>
        <label>
          Losgröße:
          <input type="number" min={1} value={lotSize} onChange={e => setLotSize(Number(e.target.value))} />
        </label>
        <label>
          Fälligkeitsdatum:
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </label>
        <label>
          Auftragstyp:
          <select value={orderType} onChange={e => setOrderType(e.target.value as OrderType)}>
            <option value="Make to Stock">Make to Stock</option>
            <option value="Make to Order">Make to Order</option>
          </select>
        </label>
        <button onClick={addOrder}>Auftrag hinzufügen</button>
      </section>
      <section>
        <h2>Aufträge</h2>
        <ul>
          {orders.map(order => (
            <li key={order.id}>
              {order.type} | Losgröße: {order.lotSize} | Fällig: {order.dueDate}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Rüstzeit-Matrix hochladen (CSV)</h2>
        <input type="file" accept=".csv" onChange={e => handleMatrixUpload(e, setSetupMatrix)} />
        <pre>{JSON.stringify(setupMatrix, null, 2)}</pre>
      </section>
      <section>
        <h2>Taktzeit-Matrix hochladen (CSV)</h2>
        <input type="file" accept=".csv" onChange={e => handleMatrixUpload(e, setCycleMatrix)} />
        <pre>{JSON.stringify(cycleMatrix, null, 2)}</pre>
      </section>
    </div>
  );
}

export default App
