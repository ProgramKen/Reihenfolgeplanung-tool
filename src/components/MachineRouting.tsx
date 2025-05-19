import { useState, useEffect } from 'react';

const API_BASE_URL = 'http://localhost:3001/api';

// Neue Typdefinitionen zur Kompatibilität mit App.tsx
interface MachineGroup {
  id: number;
  name: string;
  description: string;
}

// Interface für Maschine mit Gruppenzugehörigkeit und fähigen Teilenummern
interface Machine {
  id: number;
  name: string;
  description: string;
  groupId: number;
  capablePartNumbers: string[];
}

interface ProductionRoute {
  partNumber: string;     // Teilenummer (Pflichtfeld)
  productName?: string;   // Produktname (optional)
  sequence: number[];     // Array mit Maschinen-IDs in der Reihenfolge der Bearbeitung
}

interface MachineRoutingProps {
  onRoutesUpdate: (machines: Machine[], routes: ProductionRoute[]) => void;
  machineGroups?: MachineGroup[]; // Maschinengruppen können übergeben werden
  onMachineGroupsUpdate?: (machineGroups: MachineGroup[]) => void; // Callback für Änderungen an Maschinengruppen
}

const MachineRouting: React.FC<MachineRoutingProps> = ({ 
  onRoutesUpdate, 
  machineGroups = [], 
  onMachineGroupsUpdate 
}) => {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [routes, setRoutes] = useState<ProductionRoute[]>([]);
  const [machineGroupsState, setMachineGroupsState] = useState<MachineGroup[]>(machineGroups);
  const [newMachine, setNewMachine] = useState<{ 
    name: string, 
    description: string, 
    groupId: number,
    capablePartNumbers: string
  }>({
    name: '',
    description: '',
    groupId: 0,
    capablePartNumbers: ''
  });
  const [newRoute, setNewRoute] = useState<{ 
    partNumber: string,
    productName: string, 
    machineIds: string 
  }>({
    partNumber: '',
    productName: '',
    machineIds: ''
  });
  
  // Neuer Zustand für Maschinengruppen
  const [newGroup, setNewGroup] = useState<{
    name: string,
    description: string
  }>({
    name: '',
    description: ''
  });

  // Maschinen, Maschinengruppen und Routen vom Server laden
  useEffect(() => {
    // Maschinengruppen laden
    fetch(`${API_BASE_URL}/machine-groups`)
      .then(res => res.json())
      .then(data => {
        setMachineGroupsState(data);
      })
      .catch(error => console.error("Error fetching machine groups:", error));
    
    // Maschinen laden
    fetch(`${API_BASE_URL}/machines`)
      .then(res => res.json())
      .then(data => setMachines(data))
      .catch(error => console.error("Error fetching machines:", error));

    // Routen laden
    fetch(`${API_BASE_URL}/routes`)
      .then(res => res.json())
      .then(data => setRoutes(data))
      .catch(error => console.error("Error fetching routes:", error));
  }, []);

  // Aktualisiert Parent-Komponente bei Änderungen an Maschinen und Routen
  useEffect(() => {
    onRoutesUpdate(machines, routes);
  }, [machines, routes, onRoutesUpdate]);
  
  // Aktualisiert Parent-Komponente bei Änderungen an Maschinengruppen
  useEffect(() => {
    if (onMachineGroupsUpdate) {
      onMachineGroupsUpdate(machineGroupsState);
    }
  }, [machineGroupsState, onMachineGroupsUpdate]);

  // Neue Maschinengruppe hinzufügen
  const addMachineGroup = async () => {
    if (!newGroup.name) {
      alert("Bitte geben Sie einen Namen für die Maschinengruppe ein.");
      return;
    }

    try {
      console.log("Sending machine group data to server:", newGroup);
      
      const response = await fetch(`${API_BASE_URL}/machine-groups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newGroup),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to add machine group: ${response.status} - ${errorText}`);
      }
      
      const savedGroup = await response.json();
      console.log("Successfully received response from server:", savedGroup);
      
      setMachineGroupsState([...machineGroupsState, savedGroup]);
      setNewGroup({ name: '', description: '' });
    } catch (error) {
      console.error("Error adding machine group:", error);
      alert("Fehler beim Hinzufügen der Maschinengruppe.");
    }
  };

  // Maschinengruppe löschen
  const deleteMachineGroup = async (id: number) => {
    // Prüfen, ob die Gruppe von Maschinen verwendet wird
    const usedByMachines = machines.some(machine => machine.groupId === id);
    if (usedByMachines) {
      alert("Diese Maschinengruppe kann nicht gelöscht werden, da sie von Maschinen verwendet wird.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/machine-groups/${id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) throw new Error('Failed to delete machine group');
      
      setMachineGroupsState(machineGroupsState.filter(group => group.id !== id));
    } catch (error) {
      console.error("Error deleting machine group:", error);
      alert("Fehler beim Löschen der Maschinengruppe.");
    }
  };

  // Neue Maschine hinzufügen
  const addMachine = async () => {
    if (!newMachine.name) {
      alert("Bitte geben Sie einen Maschinennamen ein.");
      return;
    }

    if (!newMachine.groupId) {
      alert("Bitte wählen Sie eine Maschinengruppe aus.");
      return;
    }

    // Umwandeln der Komma-getrennten Teilenummern in ein Array
    const capablePartNumbersArray = newMachine.capablePartNumbers
      ? newMachine.capablePartNumbers.split(',').map(part => part.trim())
      : [];

    try {
      const machineData = {
        name: newMachine.name,
        description: newMachine.description,
        groupId: newMachine.groupId,
        capablePartNumbers: capablePartNumbersArray
      };

      const response = await fetch(`${API_BASE_URL}/machines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(machineData),
      });
      
      if (!response.ok) throw new Error('Failed to add machine');
      
      const savedMachine = await response.json();
      setMachines([...machines, savedMachine]);
      setNewMachine({ name: '', description: '', groupId: 0, capablePartNumbers: '' });
    } catch (error) {
      console.error("Error adding machine:", error);
      alert("Fehler beim Hinzufügen der Maschine.");
    }
  };

  // Maschine löschen
  const deleteMachine = async (id: number) => {
    // Keine Prüfung auf Routen notwendig, da Routen jetzt Maschinengruppen referenzieren, nicht einzelne Maschinen

    try {
      const response = await fetch(`${API_BASE_URL}/machines/${id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) throw new Error('Failed to delete machine');
      
      setMachines(machines.filter(machine => machine.id !== id));
    } catch (error) {
      console.error("Error deleting machine:", error);
      alert("Fehler beim Löschen der Maschine.");
    }
  };

  // Neue Fertigungsroute hinzufügen
  const addRoute = async () => {
    if (!newRoute.partNumber || !newRoute.machineIds) {
      alert("Bitte geben Sie eine Teilenummer und die Maschinengruppen-Reihenfolge ein.");
      return;
    }

    // Umwandeln der Komma-getrennten Maschinengruppen-IDs in ein Array
    const machineGroupIdArray = newRoute.machineIds.split(',').map(id => parseInt(id.trim(), 10));
    
    // Prüfen, ob alle angegebenen Maschinengruppen existieren
    const validGroups = machineGroupIdArray.every(id => machineGroupsState.some(group => group.id === id));
    if (!validGroups) {
      alert("Eine oder mehrere angegebene Maschinengruppen existieren nicht.");
      return;
    }

    const routeData = {
      partNumber: newRoute.partNumber,
      productName: newRoute.productName || undefined, // Optional, daher kann es undefined sein
      sequence: machineGroupIdArray
    };

    try {
      const response = await fetch(`${API_BASE_URL}/routes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(routeData),
      });
      
      if (!response.ok) throw new Error('Failed to add route');
      
      const savedRoute = await response.json();
      setRoutes([...routes, savedRoute]);
      setNewRoute({ partNumber: '', productName: '', machineIds: '' });
    } catch (error) {
      console.error("Error adding route:", error);
      alert("Fehler beim Hinzufügen der Fertigungsroute.");
    }
  };

  // Fertigungsroute löschen
  const deleteRoute = async (partNumber: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/routes/${encodeURIComponent(partNumber)}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) throw new Error('Failed to delete route');
      
      setRoutes(routes.filter(route => route.partNumber !== partNumber));
    } catch (error) {
      console.error("Error deleting route:", error);
      alert("Fehler beim Löschen der Fertigungsroute.");
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-8">
      <h2 className="text-xl font-semibold text-gray-800 mb-4 border-b pb-2">
        Maschinen und Fertigungsrouten
      </h2>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Maschinengruppen-Verwaltung */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">Maschinengruppen</h3>
          
          <div className="mb-4 grid grid-cols-1 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gruppenname</label>
              <input
                type="text"
                value={newGroup.name}
                onChange={e => setNewGroup({...newGroup, name: e.target.value})}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="z.B. Fräsen"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Beschreibung</label>
              <input
                type="text"
                value={newGroup.description}
                onChange={e => setNewGroup({...newGroup, description: e.target.value})}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="z.B. Fräsmaschinen"
              />
            </div>
            
            <div>
              <button
                onClick={addMachineGroup}
                className="inline-flex justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Maschinengruppe hinzufügen
              </button>
            </div>
          </div>
          
          {machineGroupsState.length === 0 ? (
            <p className="text-gray-500 text-center py-2">Noch keine Maschinengruppen erfasst.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Beschreibung</th>
                    <th scope="col" className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Aktion</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {machineGroupsState.map(group => (
                    <tr key={group.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{group.id}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{group.name}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{group.description}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => deleteMachineGroup(group.id)}
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

        {/* Maschinen-Verwaltung */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">Maschinen</h3>
          
          <div className="mb-4 grid grid-cols-1 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Maschinenname</label>
              <input
                type="text"
                value={newMachine.name}
                onChange={e => setNewMachine({...newMachine, name: e.target.value})}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="z.B. Fräse 1"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Beschreibung</label>
              <input
                type="text"
                value={newMachine.description}
                onChange={e => setNewMachine({...newMachine, description: e.target.value})}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="z.B. CNC-Fräse Arbeitsplatz 1"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Maschinengruppe</label>
              <select
                value={newMachine.groupId}
                onChange={e => setNewMachine({...newMachine, groupId: parseInt(e.target.value, 10)})}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value={0}>Bitte wählen...</option>
                {machineGroupsState.map(group => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fähige Teilenummern (kommagetrennt)
              </label>
              <input
                type="text"
                value={newMachine.capablePartNumbers}
                onChange={e => setNewMachine({...newMachine, capablePartNumbers: e.target.value})}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="z.B. T-1001,T-2002,d"
              />
              <p className="mt-1 text-xs text-gray-500">
                Geben Sie alle Teilenummern ein, die diese Maschine verarbeiten kann.
              </p>
            </div>
            
            <div>
              <button
                onClick={addMachine}
                className="inline-flex justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Maschine hinzufügen
              </button>
            </div>
          </div>
          
          {machines.length === 0 ? (
            <p className="text-gray-500 text-center py-2">Noch keine Maschinen erfasst.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Beschreibung</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Gruppe</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fähige Teilenummern</th>
                    <th scope="col" className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Aktion</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {machines.map(machine => {
                    const machineGroup = machineGroupsState.find(group => group.id === machine.groupId);
                    return (
                    <tr key={machine.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{machine.id}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{machine.name}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{machine.description}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{machineGroup ? machineGroup.name : 'Keine Gruppe'}</td>
                      <td className="px-3 py-2 text-sm text-gray-900">
                        {machine.capablePartNumbers && machine.capablePartNumbers.length > 0 
                          ? machine.capablePartNumbers.join(', ')
                          : 'Keine'
                        }
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => deleteMachine(machine.id)}
                          className="text-red-600 hover:text-red-900 focus:outline-none"
                        >
                          Löschen
                        </button>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Fertigungsrouten-Verwaltung */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">Fertigungsrouten</h3>
          
          <div className="mb-4 grid grid-cols-1 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Teilenummer <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={newRoute.partNumber}
                onChange={e => setNewRoute({...newRoute, partNumber: e.target.value})}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="z.B. T-10001"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Produktname (optional)</label>
              <input
                type="text"
                value={newRoute.productName}
                onChange={e => setNewRoute({...newRoute, productName: e.target.value})}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="z.B. Produkt X"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Maschinengruppen-Reihenfolge (Gruppen-IDs, kommagetrennt)
              </label>
              <input
                type="text"
                value={newRoute.machineIds}
                onChange={e => setNewRoute({...newRoute, machineIds: e.target.value})}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="z.B. 1,3,2"
              />
              <p className="mt-1 text-xs text-gray-500">
                Geben Sie die Maschinengruppen-IDs in der Reihenfolge ein, in der das Produkt bearbeitet werden soll.
              </p>
            </div>
            
            <div>
              <button
                onClick={addRoute}
                className="inline-flex justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Fertigungsroute hinzufügen
              </button>
            </div>
          </div>
          
          {routes.length === 0 ? (
            <p className="text-gray-500 text-center py-2">Noch keine Fertigungsrouten erfasst.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Teilenummer</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Produktname</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Maschinenfolge</th>
                    <th scope="col" className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Aktion</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {routes.map(route => (
                    <tr key={route.partNumber} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{route.partNumber}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{route.productName || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                        {route.sequence.map(groupId => {
                          const group = machineGroupsState.find(g => g.id === groupId);
                          return group ? group.name : `ID:${groupId}`;
                        }).join(" → ")}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => deleteRoute(route.partNumber)}
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
      </div>
    </div>
  );
};

export default MachineRouting;
