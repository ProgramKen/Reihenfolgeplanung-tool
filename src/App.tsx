import { useState, useEffect } from 'react';
import './App.css';
import OrderScheduling from './components/OrderScheduling';
import MachineRouting from './components/MachineRouting';

const API_BASE_URL = 'http://localhost:3001/api'; // Backend API URL
const API_STATUS_CHECK_URL = 'http://localhost:3001/api/orders'; // URL zum Überprüfen der Backend-Verbindung

// Typen für Aufträge und Matrizen
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

// Neue Typen für Maschinen, Maschinengruppen und Routen
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

function App() {
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [orderName, setOrderName] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [reportNumber, setReportNumber] = useState('');
  const [lotSize, setLotSize] = useState(1);
  const [dueDate, setDueDate] = useState('');
  const [orderType, setOrderType] = useState<OrderType>('Make to Stock');
  
  // Hilfsfunktion für die Formularvalidierung
  const validateOrderForm = () => {
    const hasMissingFields = !orderName.trim() || !partNumber.trim() || 
                            !reportNumber.trim() || !dueDate.trim();
    
    const hasExistingReportNumber = orders.some(o => 
      o.reportNumber.trim().toLowerCase() === reportNumber.trim().toLowerCase()
    );
    
    const hasInvalidDate = dueDate.trim() && new Date(dueDate) < new Date();
    
    return {
      valid: !hasMissingFields && !hasExistingReportNumber && !hasInvalidDate,
      hasMissingFields,
      hasExistingReportNumber,
      hasInvalidDate
    };
  };
  const [setupMatrix, setSetupMatrix] = useState<Matrix>({});
  const [cycleMatrix, setCycleMatrix] = useState<Matrix>({});
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineGroups, setMachineGroups] = useState<MachineGroup[]>([]);
  const [routes, setRoutes] = useState<ProductionRoute[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [backendConnected, setBackendConnected] = useState<boolean>(false);

  // Überprüfe Verbindung zum Backend
  useEffect(() => {
    const checkBackendConnection = async () => {
      try {
        const response = await fetch(API_STATUS_CHECK_URL, { method: 'HEAD' });
        setBackendConnected(response.ok);
        if (!response.ok) {
          setLoadingError("Backend-Server ist nicht erreichbar. Bitte starten Sie den Server und laden Sie die Seite neu.");
        }
      } catch (error) {
        console.error("Backend-Verbindungsfehler:", error);
        setBackendConnected(false);
        setLoadingError("Verbindung zum Backend-Server fehlgeschlagen. Bitte starten Sie den Server und laden Sie die Seite neu.");
      }
    };
    
    checkBackendConnection();
  }, []);
  
  // Daten vom Backend laden
  useEffect(() => {
    if (!backendConnected) {
      setIsLoading(false);
      return; // Keine Daten laden, wenn keine Verbindung zum Backend besteht
    }
    
    const fetchData = async () => {
      setIsLoading(true);
      setLoadingError(null);
      
      try {
        // Aufträge laden
        try {
          const ordersRes = await fetch(`${API_BASE_URL}/orders`);
          if (!ordersRes.ok) {
            throw new Error(`HTTP error! status: ${ordersRes.status}`);
          }
          const ordersData = await ordersRes.json();
          setOrders(ordersData);
          console.log("Orders geladen:", ordersData);
        } catch (error) {
          console.error("Fehler beim Laden der Aufträge:", error);
          setLoadingError(`Fehler beim Laden der Aufträge: ${error}`);
        }
  
        // Rüstmatrix laden
        try {
          const setupRes = await fetch(`${API_BASE_URL}/setup-matrix`);
          if (!setupRes.ok) {
            throw new Error(`HTTP error! status: ${setupRes.status}`);
          }
          const setupData = await setupRes.json();
          setSetupMatrix(setupData);
          console.log("Setup-Matrix geladen:", setupData);
        } catch (error) {
          console.error("Fehler beim Laden der Rüstmatrix:", error);
          // Leere Matrix als Fallback
          setSetupMatrix({});
        }
  
        // Taktmatrix laden
        try {
          const cycleRes = await fetch(`${API_BASE_URL}/cycle-matrix`);
          if (!cycleRes.ok) {
            throw new Error(`HTTP error! status: ${cycleRes.status}`);
          }
          const cycleData = await cycleRes.json();
          setCycleMatrix(cycleData);
          console.log("Cycle-Matrix geladen:", cycleData);
        } catch (error) {
          console.error("Fehler beim Laden der Taktmatrix:", error);
          // Leere Matrix als Fallback
          setCycleMatrix({});
        }
        
        // Maschinengruppen laden
        try {
          const machineGroupsRes = await fetch(`${API_BASE_URL}/machine-groups`);
          if (!machineGroupsRes.ok) {
            throw new Error(`HTTP error! status: ${machineGroupsRes.status}`);
          }
          const machineGroupsData = await machineGroupsRes.json();
          setMachineGroups(machineGroupsData);
          console.log("Maschinengruppen geladen:", machineGroupsData);
        } catch (error) {
          console.error("Fehler beim Laden der Maschinengruppen:", error);
          // Leeres Array als Fallback
          setMachineGroups([]);
        }
        
        // Maschinen laden
        try {
          const machinesRes = await fetch(`${API_BASE_URL}/machines`);
          if (!machinesRes.ok) {
            throw new Error(`HTTP error! status: ${machinesRes.status}`);
          }
          const machinesData = await machinesRes.json();
          setMachines(machinesData);
          console.log("Maschinen geladen:", machinesData);
        } catch (error) {
          console.error("Fehler beim Laden der Maschinen:", error);
          // Leeres Array als Fallback
          setMachines([]);
        }
      
        // Fertigungsrouten laden
        try {
          const routesRes = await fetch(`${API_BASE_URL}/routes`);
          if (!routesRes.ok) {
            throw new Error(`HTTP error! status: ${routesRes.status}`);
          }
          const routesData = await routesRes.json();
          setRoutes(routesData);
          console.log("Routen geladen:", routesData);
        } catch (error) {
          console.error("Fehler beim Laden der Routen:", error);
          // Leeres Array als Fallback
          setRoutes([]);
        }
      } catch (error) {
        console.error("Allgemeiner Fehler beim Laden der Daten:", error);
        setLoadingError(`Allgemeiner Fehler beim Laden der Daten: ${error}`);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchData();
  }, [backendConnected]);

  // Callback-Funktion für Updates an Maschinen und Routen
  const handleRoutesUpdate = (updatedMachines: Machine[], updatedRoutes: ProductionRoute[]) => {
    // Aktualisieren der Maschinen und Routen im Application State
    setMachines(updatedMachines);
    setRoutes(updatedRoutes);
  };

  // Callback-Funktion für Updates an Maschinengruppen
  const handleMachineGroupsUpdate = (updatedMachineGroups: MachineGroup[]) => {
    // Aktualisieren der Maschinengruppen im Application State
    setMachineGroups(updatedMachineGroups);
    console.log("Maschinengruppen in App aktualisiert:", updatedMachineGroups);
  };

  // Auftrag hinzufügen
  const addOrder = async () => {
    // Debug-Ausgabe um zu sehen, welche Werte tatsächlich in den Variablen stecken
    console.log("Validierung Auftragsdaten:", { 
      orderName, 
      partNumber, 
      reportNumber, 
      dueDate, 
      isEmpty: !dueDate.trim() || !orderName.trim() || !partNumber.trim() || !reportNumber.trim() 
    });
    
    // Detaillierte Validierung mit Identifikation spezifischer fehlender Felder
    const missingFields = [];
    
    if (!orderName.trim()) missingFields.push("Auftragsname");
    if (!partNumber.trim()) missingFields.push("Teilenummer");
    if (!reportNumber.trim()) missingFields.push("Rückmeldenummer");
    
    // Erweiterte Prüfung für das Datum - einige Browser geben z.B. leere Strings oder "dd.mm.yyyy" zurück
    const dueDateValue = dueDate.trim();
    if (!dueDateValue || dueDateValue === "dd.mm.yyyy" || 
        !dueDateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
      missingFields.push("Fälligkeitsdatum");
    }
    
    // Erst prüfen, ob alle Pflichtfelder ausgefüllt sind
    if (missingFields.length > 0) {
      alert(`Bitte füllen Sie alle Pflichtfelder aus: ${missingFields.join(", ")}`);
      return;
    }
    
    // Dann zusätzliche Validierungen durchführen
    const selectedDate = new Date(dueDateValue);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Stunden, Minuten, Sekunden und Millisekunden auf 0 setzen
    
    if (selectedDate < today) {
      alert("Das Fälligkeitsdatum darf nicht in der Vergangenheit liegen.");
      return;
    }
    // Prüfen, ob ein Auftrag mit derselben Rückmeldenummer bereits existiert
    const existingReportNumber = orders.find(order => 
      order.reportNumber.trim().toLowerCase() === reportNumber.trim().toLowerCase()
    );
    
    if (existingReportNumber) {
      alert(`Es existiert bereits ein Auftrag mit der Rückmeldenummer "${reportNumber}". Bitte geben Sie eine eindeutige Rückmeldenummer ein.`);
      return;
    }
    
    const newOrderData = {
      name: orderName.trim(),
      partNumber: partNumber.trim(),
      reportNumber: reportNumber.trim(),
      type: orderType,
      lotSize,
      dueDate: dueDate.trim(),
    };
    try {
      const response = await fetch(`${API_BASE_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newOrderData),
      });
      
      if (!response.ok) {
        // Versuchen, die Fehlermeldung vom Server zu bekommen
        let errorMessage = 'Fehler beim Hinzufügen des Auftrags.';
        try {
          const errorResponse = await response.json();
          if (errorResponse.message) {
            errorMessage = errorResponse.message;
          }
        } catch (e) {
          // Wenn keine JSON-Antwort kommt, verwenden wir den HTTP-Statustext
          errorMessage += ` (${response.status}: ${response.statusText})`;
        }
        throw new Error(errorMessage);
      }
      
      const savedOrder = await response.json();
      setOrders([...orders, savedOrder]);
      
      // Formular zurücksetzen
      setOrderName('');
      setPartNumber('');
      setReportNumber('');
      setLotSize(1);
      setDueDate('');
      setOrderType('Make to Stock');
      
      // Erfolgsmeldung anzeigen
      alert(`Auftrag "${savedOrder.name}" erfolgreich hinzugefügt.`);
    } catch (error) {
      console.error("Error adding order:", error);
      alert(error instanceof Error ? error.message : "Fehler beim Hinzufügen des Auftrags.");
    }
  };

  // Auftrag löschen
  const deleteOrder = async (id: number) => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete order');
      setOrders(orders.filter(order => order.id !== id));
    } catch (error) {
      console.error("Error deleting order:", error);
      alert("Fehler beim Löschen des Auftrags.");
    }
  };

  // Matrix-Import (CSV-Format) und Upload zum Backend
  const handleMatrixUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    matrixType: 'setup' | 'cycle'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) throw new Error("CSV must have at least a header and one data row.");
        const header = lines[0].split(',').map((h) => h.trim());
        const matrixData: Matrix = {};
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',').map((p) => p.trim());
          const from = parts[0];
          matrixData[from] = {};
          for (let j = 1; j < parts.length; j++) {
            if (header[j] === undefined || parts[j] === undefined) {
                console.warn(`Skipping malformed data at row ${i}, column ${j}`);
                continue;
            }
            matrixData[from][header[j]] = Number(parts[j]);
          }
        }

        const endpoint = matrixType === 'setup' ? `${API_BASE_URL}/setup-matrix` : `${API_BASE_URL}/cycle-matrix`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(matrixData),
        });

        if (!response.ok) throw new Error(`Failed to upload ${matrixType} matrix`);
        const savedMatrix = await response.json();

        if (matrixType === 'setup') {
          setSetupMatrix(savedMatrix);
        } else {
          setCycleMatrix(savedMatrix);
        }
        alert(`${matrixType === 'setup' ? 'Rüstzeit' : 'Taktzeit'}-Matrix erfolgreich hochgeladen.`);
      } catch (error) {
        console.error(`Error uploading ${matrixType} matrix:`, error);
        alert(`Fehler beim Hochladen der ${matrixType === 'setup' ? 'Rüstzeit' : 'Taktzeit'}-Matrix.`);
      }
    };
    reader.readAsText(file);
    // Reset file input to allow re-uploading the same file
    e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-center text-blue-800 mb-8">Reihenfolgeplanung Fließfertigung</h1>
        
        {isLoading && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8 flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mr-3"></div>
            <p className="text-lg text-gray-700">Daten werden geladen...</p>
          </div>
        )}
        
        {loadingError && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-8">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-700">{loadingError}</p>
              </div>
            </div>
          </div>
        )}
        
        {/* Auftrag erfassen */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-4 border-b pb-2">Auftrag erfassen</h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mt-4">
            <div className="col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Auftragsname <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={orderName}
                onChange={e => setOrderName(e.target.value)}
                placeholder="z.B. Auftrag X"
                className={`w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  orderName.trim() ? 'border-green-300 bg-green-50' : 'border-gray-300'
                }`}
                required
              />
            </div>
            <div className="col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Teilenummer <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={partNumber}
                onChange={e => setPartNumber(e.target.value)}
                placeholder="z.B. T-10001"
                className={`w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  partNumber.trim() ? 'border-green-300 bg-green-50' : 'border-gray-300'
                }`}
                required
              />
            </div>
            <div className="col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rückmeldenummer <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={reportNumber}
                onChange={e => setReportNumber(e.target.value)}
                placeholder="z.B. RM-2025-12345"
                className={`w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  reportNumber.trim() 
                    ? orders.some(o => o.reportNumber.trim().toLowerCase() === reportNumber.trim().toLowerCase())
                      ? 'border-red-300 bg-red-50'
                      : 'border-green-300 bg-green-50'
                    : 'border-gray-300'
                }`}
                required
              />
              {reportNumber.trim() && orders.some(o => 
                o.reportNumber.trim().toLowerCase() === reportNumber.trim().toLowerCase()
              ) && (
                <p className="text-xs text-red-600 mt-1">Diese Rückmeldenummer existiert bereits!</p>
              )}
            </div>
            <div className="col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Losgröße
              </label>
              <input
                type="number"
                min={1}
                value={lotSize}
                onChange={e => setLotSize(Number(e.target.value))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fälligkeitsdatum <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className={`w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  dueDate.trim() ? 'border-green-300 bg-green-50' : 'border-gray-300'
                }`}
                required
              />
              {dueDate.trim() && new Date(dueDate) < new Date() && (
                <p className="text-xs text-red-600 mt-1">Datum liegt in der Vergangenheit!</p>
              )}
            </div>
            <div className="col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Auftragstyp
              </label>
              <select
                value={orderType}
                onChange={e => setOrderType(e.target.value as OrderType)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="Make to Stock">Make to Stock</option>
                <option value="Make to Order">Make to Order</option>
              </select>
            </div>
          </div>
          <div className="mt-6 text-right">
            {/* Validierung des Formulars */}
            {(() => {
              const validation = validateOrderForm();
              return (
                <>
                  {!validation.valid && (
                    <span className="text-sm text-amber-600 mr-3">
                      {validation.hasMissingFields && "Bitte alle Pflichtfelder ausfüllen"}
                      {validation.hasExistingReportNumber && "Diese Rückmeldenummer existiert bereits"}
                      {validation.hasInvalidDate && "Fälligkeitsdatum darf nicht in der Vergangenheit liegen"}
                    </span>
                  )}
                  <button 
                    onClick={addOrder}
                    disabled={!validation.valid}
                    className={`inline-flex justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white 
                      ${!validation.valid
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
                      }`}
                  >
                    Auftrag hinzufügen
                  </button>
                </>
              );
            })()}
          </div>
        </div>
        
        {/* Auftragsliste */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-4 border-b pb-2">Auftragsliste</h2>
          {orders.length === 0 ? (
            <p className="text-gray-500 text-center py-4">Noch keine Aufträge erfasst oder geladen.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Teilenummer</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rückmeldenummer</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Typ</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Losgröße</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fällig bis</th>
                    <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Aktion</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {orders.map(order => (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{order.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{order.partNumber}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{order.reportNumber}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          order.type === 'Make to Order' 
                            ? 'bg-red-100 text-red-800' 
                            : 'bg-green-100 text-green-800'
                        }`}>
                          {order.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{order.lotSize}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{order.dueDate}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button 
                          onClick={() => deleteOrder(order.id)} 
                          className="text-red-600 hover:text-red-900 focus:outline-none"
                        >
                          Löschen
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        
        {/* Maschinen und Fertigungsrouten */}
        <MachineRouting 
          onRoutesUpdate={handleRoutesUpdate} 
          onMachineGroupsUpdate={handleMachineGroupsUpdate}
          machineGroups={machineGroups}
        />

        {/* OrderScheduling Komponente */}
        <OrderScheduling 
          orders={orders}
          setupMatrix={setupMatrix}
          cycleMatrix={cycleMatrix}
          machines={machines}
          machineGroups={machineGroups}
          routes={routes}
        />

        <div className="grid md:grid-cols-2 gap-8 mb-8">
          {/* Rüstzeit-Matrix */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4 border-b pb-2">Rüstzeit-Matrix</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">CSV-Datei hochladen</label>
              <div className="flex items-center">
                <label className="cursor-pointer bg-blue-50 hover:bg-blue-100 text-blue-600 px-4 py-2 rounded-l-md border border-blue-300">
                  <span>Datei wählen</span>
                  <input type="file" accept=".csv" onChange={e => handleMatrixUpload(e, 'setup')} className="hidden" />
                </label>
                <span className="border-t border-b border-r border-gray-300 px-3 py-2 bg-gray-50 rounded-r-md text-sm text-gray-500">CSV-Format</span>
              </div>
            </div>
            {Object.keys(setupMatrix).length > 0 && (
              <div className="mt-4 p-4 bg-gray-50 rounded-md">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Matrix-Vorschau:</h3>
                <div className="overflow-x-auto text-xs">
                  <pre className="whitespace-pre-wrap">{JSON.stringify(setupMatrix, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>

          {/* Taktzeit-Matrix */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4 border-b pb-2">Taktzeit-Matrix</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">CSV-Datei hochladen</label>
              <div className="flex items-center">
                <label className="cursor-pointer bg-blue-50 hover:bg-blue-100 text-blue-600 px-4 py-2 rounded-l-md border border-blue-300">
                  <span>Datei wählen</span>
                  <input type="file" accept=".csv" onChange={e => handleMatrixUpload(e, 'cycle')} className="hidden" />
                </label>
                <span className="border-t border-b border-r border-gray-300 px-3 py-2 bg-gray-50 rounded-r-md text-sm text-gray-500">CSV-Format</span>
              </div>
            </div>
            {Object.keys(cycleMatrix).length > 0 && (
              <div className="mt-4 p-4 bg-gray-50 rounded-md">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Matrix-Vorschau:</h3>
                <div className="overflow-x-auto text-xs">
                  <pre className="whitespace-pre-wrap">{JSON.stringify(cycleMatrix, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
