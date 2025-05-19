import { useState, useEffect } from 'react';
import { format, addDays } from 'date-fns';
import { de } from 'date-fns/locale';
import './OrderScheduling.css';
import ImprovedGanttChart from './ImprovedGanttChart';
import MTOMTSScheduler from '../algorithm/MTOMTSScheduler';

// Typdefinitionen
type OrderType = 'Make to Stock' | 'Make to Order';

interface ProductionOrder {
  id: number;
  name: string;
  partNumber: string;     // Teilenummer (Pflichtfeld)
  reportNumber: string;   // Rückmeldenummer (Pflichtfeld)
  type: OrderType;
  lotSize: number;
  dueDate: string;
}

interface Matrix {
  [from: string]: { [to: string]: number };
}

// Neu: Interface für Maschinengruppe
interface MachineGroup {
  id: number;
  name: string;
  description: string;
}

interface Machine {
  id: number;
  name: string;
  description: string;
  groupId: number;         // Zugehörigkeit zu einer Maschinengruppe
  capablePartNumbers: string[]; // Liste der Teilenummern, die diese Maschine fertigen kann
}

interface ProductionRoute {
  partNumber: string;     // Teilenummer (Pflichtfeld)
  productName?: string;   // Produktname (optional)
  sequence: number[];     // Sequenz von Maschinengruppen-IDs (nicht mehr direkte Maschinen-IDs)
}

interface ScheduleItem {
  orderName: string;
  partNumber: string;      // Teilenummer hinzugefügt
  reportNumber: string;    // Rückmeldenummer hinzugefügt
  machineId: number;
  start: number;           // Startzeit in Minuten seit Beginn der Planung
  end: number;             // Endzeit in Minuten
  setupTime: number;
  processingTime: number;
  type?: OrderType;        // Auftragstyp für die visuelle Unterscheidung
}

interface MachineSchedule {
  machineId: number;
  machineName: string;
  slots: ScheduleItem[];
}

interface OrderSchedulingProps {
  orders: ProductionOrder[];
  setupMatrix: Matrix;
  cycleMatrix: Matrix;
  machines: Machine[];
  machineGroups: MachineGroup[]; // Neu: Maschinengruppen als Property
  routes: ProductionRoute[];
}

const OrderScheduling: React.FC<OrderSchedulingProps> = ({
  orders,
  setupMatrix,
  cycleMatrix,
  machines,
  machineGroups,
  routes,
}) => {
  const [schedule, setSchedule] = useState<MachineSchedule[]>([]);
  const [startDate, setStartDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  
  // Zustandsvariable für die aktuelle Ansicht (Gantt, Timeline oder Tabelle)
  const [viewMode, setViewMode] = useState<'gantt' | 'timeline' | 'table'>('gantt');
  
  // Gantt-Chart Zoomfaktor
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  
  // Neue State-Variablen für die Animationen und Fortschrittsanzeigen
  const [isPlanning, setIsPlanning] = useState<boolean>(false);
  const [planningPhase, setPlanningPhase] = useState<string>("");
  const [planningProgress, setPlanningProgress] = useState<number>(0);
  const [planningLog, setPlanningLog] = useState<{ message: string, time: Date }[]>([]);
  const [currentOrder, setCurrentOrder] = useState<ProductionOrder | null>(null);
  const [bottleneckGroups, setBottleneckGroups] = useState<number[]>([]);
  
  // Neue State-Variable für die Gewichtung der Optimierungskriterien
  const [weightFactors, setWeightFactors] = useState({
    startTime: 0.05,     // Gewichtung für frühen Startzeitpunkt
    endTime: 0.05,       // Gewichtung für frühe Fertigstellung
    setupTime: 0.30,     // Gewichtung für geringen Rüstzeitanteil (α = 0.3)
    machineLoad: 0.00,   // Gewichtung für niedrige Maschinenauslastung
    dueDate: 0.40,       // Gewichtung für Liefertermintreue (β = 0.4)
    bottleneck: 0.20     // Gewichtung für Engpass-Optimierung (γ = 0.2)
  });
  
  const [planningResults, setPlanningResults] = useState<{
    makeToStockOrders: number;
    makeToOrderOrders: number;
    totalSetupTime: number;
    totalProcessingTime: number;
    scheduleEndTime: number;
  }>({
    makeToStockOrders: 0,
    makeToOrderOrders: 0,
    totalSetupTime: 0,
    totalProcessingTime: 0,
    scheduleEndTime: 0,
  });

  // Hilfsfunktion: Findet die Route für einen bestimmten Auftrag basierend auf der Teilenummer
  const findRouteForOrder = (partNumber: string): ProductionRoute | undefined => {
    return routes.find(route => route.partNumber === partNumber);
  };

  // Neu: Findet alle geeigneten Maschinen für eine Maschinengruppe und Teilenummer
  const findCapableMachinesInGroup = (
    groupId: number,
    partNumber: string
  ): Machine[] => {
    // Filtere Maschinen nach Gruppenzugehörigkeit und Fähigkeit, die Teilenummer zu fertigen
    return machines.filter(
      machine => 
        machine.groupId === groupId && 
        machine.capablePartNumbers.includes(partNumber)
    );
  };

  // Neu: Bewertet, welche Maschine aus einer Gruppe am besten für einen Auftrag geeignet ist
  const findOptimalMachineForOrder = (
    capableMachines: Machine[],
    order: ProductionOrder,
    machineSchedules: MachineSchedule[],
    currentTime: number
  ): { machineId: number, startTime: number, setupTime: number } => {
    // Default-Werte, falls keine Maschine gefunden wird
    let bestMachineId = -1;
    let earliestStartTime = Number.MAX_SAFE_INTEGER;
    let requiredSetupTime = 0;
    
    // Wenn keine fähige Maschine gefunden wurde
    if (capableMachines.length === 0) {
      console.error(`Keine fähige Maschine für Teilenummer ${order.partNumber} gefunden!`);
      return { machineId: -1, startTime: 0, setupTime: 0 };
    }

    // Beste Bewertung für die Maschinen
    let bestScore = Number.NEGATIVE_INFINITY;
    
    // Due Date des Auftrags als Date-Objekt
    const dueDate = new Date(order.dueDate).getTime();
    const startDateAsTime = new Date(startDate).getTime();
    
    // Für jede fähige Maschine in der Gruppe
    for (const machine of capableMachines) {
      // Frühestmöglichen Startzeitpunkt für diese Maschine ermitteln
      const { startTime, setupTime } = findEarliestStartTimeForMachine(
        machine.id, 
        order,
        machineSchedules
      );
      
      // Tatsächlicher Startzeitpunkt (nach vorheriger Bearbeitung)
      const actualStartTime = Math.max(startTime, currentTime);
      
      // Bearbeitungszeit berechnen - mit Maschinen-ID
      const processingTime = calculateProcessingTime(order.partNumber, order.lotSize, machine.id);
      
      // Endzeit berechnen
      const endTime = actualStartTime + setupTime + processingTime;
      
      // Gesamte Bearbeitungszeit für diesen Auftrag auf dieser Maschine
      const totalJobTime = setupTime + processingTime;
      
      // Verhältnis der Rüstzeit zur Gesamtarbeitszeit (kleiner ist besser)
      const setupRatio = setupTime / totalJobTime;

      // Aktuelle Auslastung der Maschine berechnen
      const machineLoad = calculateMachineLoad(machine.id, machineSchedules);
      
      // Due Date Abweichung (in Minuten) berechnen
      // Konvertiere endTime (in Minuten seit Planungsbeginn) in Millisekunden seit Epoch
      const endDateAsTime = startDateAsTime + endTime * 60 * 1000;
      const dueDateDeviation = (endDateAsTime - dueDate) / (60 * 1000); // Umrechnung in Minuten
      
      // Multi-Kriterienbewertung mit dynamischen Gewichtungen:
      const score = 
        -weightFactors.startTime * actualStartTime +      // Früher Start wird bevorzugt
        -weightFactors.endTime * endTime +                // Frühere Fertigstellung wird bevorzugt
        -weightFactors.setupTime * setupRatio +           // Geringerer Rüstzeitanteil wird bevorzugt
        -weightFactors.machineLoad * machineLoad +        // Weniger ausgelastete Maschinen werden bevorzugt
        -weightFactors.dueDate * dueDateDeviation;        // Einhaltung des Due Date wird bevorzugt
      
      console.log(`Maschine ${machine.id} Score: ${score}, Start: ${actualStartTime}, Ende: ${endTime}, Rüstverhältnis: ${setupRatio}, Last: ${machineLoad}, DueDateAbweichung: ${dueDateDeviation}`);
      
      // Wenn diese Maschine eine bessere Bewertung hat als die bisherigen Optionen
      if (score > bestScore) {
        bestScore = score;
        earliestStartTime = actualStartTime;
        bestMachineId = machine.id;
        requiredSetupTime = setupTime;
      }
    }
    
    console.log(`Beste Maschine gefunden: ID ${bestMachineId} mit Score ${bestScore} und Startzeit ${earliestStartTime}`);
    return { 
      machineId: bestMachineId, 
      startTime: earliestStartTime, 
      setupTime: requiredSetupTime 
    };
  };

  // Hilfsfunktion: Berechnet die aktuelle Auslastung einer Maschine
  const calculateMachineLoad = (machineId: number, machineSchedules: MachineSchedule[]): number => {
    const machineSchedule = machineSchedules.find(ms => ms.machineId === machineId);
    
    if (!machineSchedule || machineSchedule.slots.length === 0) {
      // Maschine ist noch nicht belegt
      return 0;
    }
    
    // Gesamtarbeitszeit der Maschine (letzte Endzeit)
    const lastSlot = machineSchedule.slots[machineSchedule.slots.length - 1];
    const totalWorkTime = lastSlot.end;
    
    // Summe der Bearbeitungs- und Rüstzeiten
    const totalJobTime = machineSchedule.slots.reduce(
      (sum, slot) => sum + slot.processingTime + slot.setupTime, 
      0
    );
    
    // Auslastungsgrad als Verhältnis (0-1, wobei 1 = 100% Auslastung)
    return totalJobTime / totalWorkTime;
  };

  // Hilfsfunktion: Berechnet die Rüstzeit zwischen zwei Produkten basierend auf Teilenummer
  const calculateSetupTime = (fromPartNumber: string, toPartNumber: string): number => {
    console.log("Berechne Rüstzeit von", fromPartNumber, "zu", toPartNumber);
    console.log("Verfügbare Rüstzeiten:", setupMatrix);
    
    if (fromPartNumber === toPartNumber) {
      console.log("Gleiche Teilenummern, keine Rüstzeit");
      return 0; // Keine Rüstzeit, wenn gleiches Produkt
    }
    
    let setupTime = 0;
    try {
      setupTime = setupMatrix[fromPartNumber]?.[toPartNumber] ?? 0;
      if (setupTime === 0 && fromPartNumber !== toPartNumber) {
        console.warn(`Keine Rüstzeit für Übergang von ${fromPartNumber} zu ${toPartNumber} gefunden, verwende Standardwert 10`);
        setupTime = 10; // Standardwert für Rüstzeit, wenn nicht definiert
      }
    } catch (error) {
      console.error("Fehler bei Rüstzeitberechnung:", error);
      setupTime = 10; // Fallback bei Fehler
    }
    
    console.log("Berechnete Rüstzeit:", setupTime);
    return setupTime;
  };

  // Hilfsfunktion: Berechnet die Bearbeitungszeit für ein Produkt basierend auf Teilenummer und Maschine
  const calculateProcessingTime = (partNumber: string, lotSize: number, machineId?: number): number => {
    console.log("Berechne Bearbeitungszeit für", partNumber, "mit Losgröße", lotSize, "auf Maschine", machineId);
    console.log("Verfügbare Taktzeiten:", cycleMatrix);
    
    let cycleTime = 0;
    try {
      // Maschine finden (falls eine Maschinen-ID angegeben wurde)
      let machineName = '';
      if (machineId) {
        const machine = machines.find(m => m.id === machineId);
        if (machine) {
          machineName = machine.name;
        }
      }
      
      // Wenn es eine maschinenspezifische Taktzeit gibt, verwende diese
      if (machineName && cycleMatrix[partNumber]?.[machineName]) {
        cycleTime = cycleMatrix[partNumber][machineName];
        console.log(`Maschinenspezifische Taktzeit für ${partNumber} auf ${machineName} gefunden: ${cycleTime}`);
      } 
      // Fallback auf eine generische Taktzeit für die Teilenummer, wenn vorhanden
      else if (cycleMatrix[partNumber]?.[partNumber]) {
        cycleTime = cycleMatrix[partNumber][partNumber];
        console.log(`Generische Taktzeit für ${partNumber} gefunden: ${cycleTime}`);
      } else {
        console.warn(`Keine Taktzeit für Teilenummer ${partNumber}${machineName ? ` auf Maschine ${machineName}` : ''} gefunden, verwende Standardwert 1`);
        cycleTime = 1; // Standardwert, wenn keine Taktzeit definiert ist
      }
    } catch (error) {
      console.error("Fehler bei Taktzeitberechnung:", error);
      cycleTime = 1; // Fallback bei Fehler
    }
    
    const totalTime = cycleTime * lotSize;
    console.log("Berechnete Bearbeitungszeit:", totalTime);
    return totalTime;
  };

  // Hilfsfunktion: Findet den frühestmöglichen Startzeitpunkt für einen Auftrag auf einer Maschine
  const findEarliestStartTimeForMachine = (
    machineId: number, 
    order: ProductionOrder, 
    machineSchedules: MachineSchedule[]
  ): { startTime: number, setupTime: number } => {
    const machineSchedule = machineSchedules.find(ms => ms.machineId === machineId);

    if (!machineSchedule || machineSchedule.slots.length === 0) {
      // Maschine ist noch nicht belegt
      return { startTime: 0, setupTime: 0 };
    }

    // Letzte Belegung der Maschine finden
    const lastSlot = machineSchedule.slots[machineSchedule.slots.length - 1];
    
    console.log("Berechne Rüstzeit für Übergang von", lastSlot.partNumber, "zu", order.partNumber);
    let setupTime = 0;
    try {
      setupTime = calculateSetupTime(lastSlot.partNumber, order.partNumber);
    } catch (error) {
      console.error("Fehler bei Rüstzeitberechnung:", error);
      // Fallback: Keine Rüstzeit
      setupTime = 0;
    }
    console.log("Berechnete Rüstzeit:", setupTime);

    // Startzeit nach dem Ende der letzten Belegung plus Rüstzeit
    return { 
      startTime: lastSlot.end, 
      setupTime 
    };
  };

  // Hilfsfunktion: Findet optimale Startzeit für einen Auftrag gemäß seiner Route
  const findOptimalStartTimeForRoute = (
    route: ProductionRoute, 
    order: ProductionOrder,
    machineSchedules: MachineSchedule[]
  ): { schedules: MachineSchedule[], totalDuration: number } => {
    let updatedMachineSchedules = [...machineSchedules];
    let currentTime = 0;
    let totalDuration = 0;

    // Für jede Maschinengruppe in der Route
    for (let i = 0; i < route.sequence.length; i++) {
      const groupId = route.sequence[i];
      
      // Alle fähigen Maschinen in dieser Gruppe für die gegebene Teilenummer finden
      const capableMachines = findCapableMachinesInGroup(groupId, order.partNumber);
      
      // Wenn keine fähige Maschine gefunden wurde, Warnung ausgeben und diesen Routenschritt überspringen
      if (capableMachines.length === 0) {
        console.warn(`Keine fähige Maschine in Gruppe ${groupId} für Teilenummer ${order.partNumber} gefunden! Routenschritt wird übersprungen.`);
        continue;
      }
      
      console.log(`Fähige Maschinen in Gruppe ${groupId} für Teilenummer ${order.partNumber}:`, capableMachines);
      
      // Die optimale Maschine aus dieser Gruppe für den aktuellen Auftrag finden
      const { machineId, startTime, setupTime } = findOptimalMachineForOrder(
        capableMachines,
        order,
        updatedMachineSchedules,
        currentTime
      );
      
      // Wenn keine geeignete Maschine gefunden wurde
      if (machineId === -1) {
        console.warn(`Konnte keine optimale Maschine in Gruppe ${groupId} für Teilenummer ${order.partNumber} finden! Routenschritt wird übersprungen.`);
        continue;
      }

      console.log(`Optimale Maschine für Gruppe ${groupId} und Teilenummer ${order.partNumber}: Maschine ID ${machineId}`);
      
      // Tatsächliche Startzeit (nach vorheriger Bearbeitung)
      const actualStartTime = Math.max(startTime, currentTime);
      
      // Bearbeitungszeit berechnen - jetzt mit Maschinen-ID
      const processingTime = calculateProcessingTime(order.partNumber, order.lotSize, machineId);
      
      // Endzeit berechnen
      const endTime = actualStartTime + setupTime + processingTime;
      
      // Neuen Slot für diese Maschine erstellen
      const newSlot: ScheduleItem = {
        orderName: order.name,
        partNumber: order.partNumber,
        reportNumber: order.reportNumber,
        machineId,
        start: actualStartTime,
        end: endTime,
        setupTime,
        processingTime,
        type: order.type // Typ des Auftrags für die visuelle Unterscheidung
      };

      // Maschinenbelegung aktualisieren
      const machineIndex = updatedMachineSchedules.findIndex(ms => ms.machineId === machineId);
      
      if (machineIndex >= 0) {
        // Maschine existiert bereits im Schedule
        updatedMachineSchedules[machineIndex].slots.push(newSlot);
      } else {
        // Neue Maschine zum Schedule hinzufügen
        const machine = machines.find(m => m.id === machineId);
        updatedMachineSchedules.push({
          machineId,
          machineName: machine?.name || `Maschine ${machineId}`,
          slots: [newSlot]
        });
      }

      // Aktuelle Zeit aktualisieren für die nächste Maschinengruppe in der Route
      currentTime = endTime;
      
      // Gesamtdauer aktualisieren
      totalDuration = Math.max(totalDuration, endTime);
    }

    return { schedules: updatedMachineSchedules, totalDuration };
  };

  // Animation-Hilfsfunktion: Log-Eintrag hinzufügen
  const addLog = (message: string) => {
    setPlanningLog(prev => [...prev, { message, time: new Date() }]);
  };

  // Reihenfolgeplanung durchführen - verwendet den neu implementierten zwei-Phasen Algorithmus
  const generateSchedule = async () => {
    try {
      // Planung starten und Fortschrittsanzeige zurücksetzen
      setIsPlanning(true);
      setPlanningProgress(0);
      setPlanningPhase("Initialisierung");
      setCurrentOrder(null);
      setPlanningLog([]);
      
      addLog("Planung wird initialisiert...");
      console.log("Planung wird durchgeführt mit zwei-Phasen MTO/MTS-Algorithmus...");
      console.log("Aufträge:", orders);
      console.log("Routen:", routes);
      console.log("Maschinen:", machines);
      console.log("Rüstmatrix:", setupMatrix);
      console.log("Taktmatrix:", cycleMatrix);

      // Fortschritt aktualisieren
      setPlanningProgress(5);
      await new Promise(resolve => setTimeout(resolve, 500)); // Animation verzögern
      
      if (orders.length === 0 || routes.length === 0 || machines.length === 0) {
        setIsPlanning(false);
        alert("Es fehlen Aufträge, Fertigungsrouten oder Maschinen für die Planung.");
        return;
      }
      
      addLog(`${orders.length} Aufträge, ${machines.length} Maschinen und ${routes.length} Routen gefunden.`);
      setPlanningProgress(10);
      
      // Instanz des optimierten Schedulers erstellen
      const scheduler = new MTOMTSScheduler(
        orders,
        setupMatrix,
        cycleMatrix,
        machines,
        machineGroups,
        routes,
        weightFactors, // Verwende die bestehenden Gewichtungsfaktoren
        addLog // Übergebe die Log-Funktion
      );
      
      // Phase ändern
      setPlanningPhase("Zwei-Phasen Optimierung");
      setPlanningProgress(15);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Live-Fortschrittsbehandlung während der Planung
      const originalAddLog = addLog;
      let currentProgress = 15;
      
      // Progress-Handler für den Scheduler (wird bei jedem Log-Eintrag aufgerufen)
      const progressHandler = (message: string) => {
        originalAddLog(message);
        
        // Phasen erkennen und Fortschritt aktualisieren
        if (message.includes("Phase 1:")) {
          setPlanningPhase("Phase 1: MTS-Basissequenz");
          currentProgress = 20;
          setPlanningProgress(currentProgress);
        } 
        else if (message.includes("Optimiere Basis-Sequenz mit Simulated Annealing")) {
          setPlanningPhase("Phase 1: Optimierung mit Simulated Annealing");
          currentProgress = 40;
          setPlanningProgress(currentProgress);
        }
        else if (message.includes("Phase 2:")) {
          setPlanningPhase("Phase 2: MTO-Integration");
          currentProgress = 60;
          setPlanningProgress(currentProgress);
        }
        else if (message.includes("Reihenfolgeplanung abgeschlossen")) {
          setPlanningPhase("Fertigstellung");
          currentProgress = 85;
          setPlanningProgress(currentProgress);
        }
        else if (message.startsWith("Integriere MTO-Auftrag:")) {
          // MTO-Fortschritt schrittweise erhöhen
          currentProgress += 1;
          setPlanningProgress(Math.min(85, currentProgress));
        }
        else if (message.includes("Temperatur:")) {
          // Simulated Annealing Fortschritt
          currentProgress += 0.5;
          setPlanningProgress(Math.min(60, currentProgress));
        }
      };
      
      // Überschreibe die Log-Funktion für Progress-Tracking
      scheduler["addLog"] = progressHandler;
      
      // Führe die optimierte Planung durch
      const result = await scheduler.generateOptimizedSchedule();
      
      // Ergebnisse setzen
      setSchedule(result.schedules);
      setPlanningResults({
        makeToStockOrders: result.makeToStockOrders,
        makeToOrderOrders: result.makeToOrderOrders,
        totalSetupTime: result.totalSetupTime,
        totalProcessingTime: result.totalProcessingTime,
        scheduleEndTime: result.scheduleEndTime,
      });
      
      // Fertigstellung
      setPlanningProgress(100);
      setPlanningPhase("Abgeschlossen");
      addLog("✅ Zwei-Phasen Planung erfolgreich abgeschlossen!");
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Planung abschließen
      setIsPlanning(false);
      
    } catch (error) {
      setIsPlanning(false);
      addLog(`❌ Fehler bei der Planung: ${error instanceof Error ? error.message : String(error)}`);
      setPlanningPhase("Fehler");
      console.error("Allgemeiner Fehler bei der Planung:", error);
      alert("Ein Fehler ist bei der Planung aufgetreten: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  // Zeitformatierung: Minuten in "Tage, Stunden:Minuten" umwandeln
  const formatDuration = (minutes: number): string => {
    const days = Math.floor(minutes / (60 * 24));
    const hours = Math.floor((minutes % (60 * 24)) / 60);
    const mins = Math.floor(minutes % 60);
    
    let result = '';
    if (days > 0) result += `${days}d `;
    result += `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    
    return result;
  };

  // Datumsformatierung: Minuten seit Beginn zur tatsächlichen Zeit umwandeln
  const formatDateFromMinutes = (minutes: number): string => {
    const date = new Date(startDate);
    const daysToAdd = Math.floor(minutes / (24 * 60));
    const hoursToAdd = Math.floor((minutes % (24 * 60)) / 60);
    const minsToAdd = minutes % 60;
    
    const resultDate = addDays(date, daysToAdd);
    resultDate.setHours(hoursToAdd, minsToAdd);
    
    return format(resultDate, 'dd.MM.yyyy HH:mm', { locale: de });
  };

  // Hilfsfunktion: Formatiert Minuten in ein Zeitformat (Stunden:Minuten)
  const formatMinutes = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
  };

  // Hilfsfunktion: Berechnet den Liefertreuewert einer Maschine (Prozentsatz pünktlich abgeschlossener Aufträge)
  const calculateOnTimeDelivery = (machineSchedule: MachineSchedule): { percentage: number; onTime: number; total: number } => {
    if (!machineSchedule || machineSchedule.slots.length === 0) return { percentage: 100, onTime: 0, total: 0 };

    let onTimeCount = 0;
    const startDateMillis = new Date(startDate).getTime();
    
    for (const slot of machineSchedule.slots) {
      const order = orders.find(o => o.name === slot.orderName);
      if (!order) continue;
      
      const endDateMillis = startDateMillis + slot.end * 60 * 1000;
      const dueDateMillis = new Date(order.dueDate).getTime();
      
      if (endDateMillis <= dueDateMillis) {
        onTimeCount++;
      }
    }
    
    const total = machineSchedule.slots.length;
    const percentage = total > 0 ? (onTimeCount / total) * 100 : 100;
    
    return { 
      percentage: Math.round(percentage), 
      onTime: onTimeCount, 
      total: total 
    };
  };

  // Gantt chart is now rendered by the ImprovedGanttChart component

  // Neuer Algorithmus zur fortgeschrittenen Visualisierung des Plans
  const renderAdvancedMachineSchedule = () => {
    return (
      <div className="machine-schedules-container">
        {schedule.map((machineSchedule) => {
          const onTimeDelivery = calculateOnTimeDelivery(machineSchedule);

          // Berechnung der Maschinenauslastung
          const machineLoad = calculateMachineLoad(machineSchedule.machineId, schedule);
          const loadPercentage = Math.round(machineLoad * 100);
          
          // Gesamtstatistiken für diese Maschine
          const totalSetupTime = machineSchedule.slots.reduce((sum, slot) => sum + slot.setupTime, 0);
          const totalProcessingTime = machineSchedule.slots.reduce((sum, slot) => sum + slot.processingTime, 0);
          const setupPercentage = Math.round((totalSetupTime / (totalSetupTime + totalProcessingTime)) * 100) || 0;
          
          return (
            <div key={machineSchedule.machineId} className="machine-schedule-advanced">
              <div className="machine-header">
                <h3>{machineSchedule.machineName}</h3>
                <div className="machine-metrics">
                  <span className="metric" title="Maschinenauslastung">
                    <i className="fas fa-cogs"></i> {loadPercentage}%
                  </span>
                  <span className={`metric ${onTimeDelivery.percentage < 85 ? 'warning' : ''}`}
                        title="Pünktliche Auslieferung">
                    <i className="fas fa-clock"></i> {onTimeDelivery.percentage}%
                  </span>
                  <span className="metric" title="Anteil Rüstzeit">
                    <i className="fas fa-tools"></i> {setupPercentage}%
                  </span>
                </div>
              </div>
              
              <div className="schedule-timeline">
                {machineSchedule.slots.map((slot, index) => {
                  const order = orders.find(o => o.name === slot.orderName);
                  const startDateMillis = new Date(startDate).getTime();
                  const endDateMillis = startDateMillis + slot.end * 60 * 1000;
                  const dueDateMillis = order ? new Date(order.dueDate).getTime() : 0;
                  const isLate = dueDateMillis > 0 && endDateMillis > dueDateMillis;
                  
                  return (
                    <div 
                      key={index} 
                      className={`timeline-slot ${isLate ? 'late-delivery' : ''}`}
                      style={{ 
                        width: `${((slot.processingTime + slot.setupTime) / planningResults.scheduleEndTime) * 100}%`,
                      }}
                    >
                      <div 
                        className="setup-time" 
                        style={{ width: `${(slot.setupTime / (slot.processingTime + slot.setupTime)) * 100}%` }}
                        title={`Rüstzeit: ${formatMinutes(slot.setupTime)}`}
                      ></div>
                      <div className="slot-details">
                        <div className="order-name">{slot.orderName}</div>
                        <div className="slot-times">
                          <small>
                            {formatMinutes(slot.start)} - {formatMinutes(slot.end)}
                            {isLate && <span className="late-indicator"> ⚠️</span>}
                          </small>
                        </div>
                        <div className="part-number">
                          <small>TN: {slot.partNumber}</small>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold text-gray-800 mb-4 border-b pb-2">
        Reihenfolgeplanung
      </h2>
      
      <div className="mb-6 space-y-4">
        <div className="flex items-center">
          <label className="block text-sm font-medium text-gray-700 mr-3">Startdatum</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          
          <button
            onClick={() => {
              console.log("Button geklickt!");
              try {
                generateSchedule();
              } catch (err) {
                console.error("Fehler beim Aufruf von generateSchedule:", err);
                alert("Fehler beim Starten der Planungsberechnung: " + (err instanceof Error ? err.message : String(err)));
              }
            }}
            className="ml-4 inline-flex justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            disabled={isPlanning}
          >
            {isPlanning ? 'Planung läuft...' : 'Planung durchführen'}
          </button>
        </div>

        {/* Animierter Fortschrittsbalken während der Planung */}
        {isPlanning && (
          <div className="mt-3 bg-gray-100 p-4 rounded-md border border-gray-200">
            <div className="mb-2 flex justify-between items-center">
              <h4 className="text-sm font-medium text-gray-700">
                {planningPhase} 
                <span className="ml-2 text-xs text-gray-500">({planningProgress.toFixed(0)}%)</span>
              </h4>
              <div className="text-xs text-gray-500">
                Verarbeitet: {planningLog.length > 0 ? `${planningLog.length} Schritte` : '0 Schritte'}
              </div>
            </div>

            {/* Fortschrittsbalken mit Animation */}
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden mb-3">
              <div 
                className="h-full bg-blue-600 rounded-full progress-bar-animated"
                style={{ width: `${planningProgress}%` }}
              />
            </div>

            {/* Aktueller Auftrag (falls vorhanden) */}
            {currentOrder && (
              <div className="mb-3 p-2 bg-blue-50 rounded border border-blue-200 text-sm">
                <div className="font-medium">Aktueller Auftrag: {currentOrder.name}</div>
                <div className="text-xs mt-1 text-gray-600">
                  <span className="mr-3">Teilenummer: {currentOrder.partNumber}</span>
                  <span className="mr-3">Typ: {currentOrder.type}</span>
                  <span className="mr-3">Losgröße: {currentOrder.lotSize}</span>
                  <span>Liefertermin: {format(new Date(currentOrder.dueDate), 'dd.MM.yyyy', { locale: de })}</span>
                </div>
              </div>
            )}

            {/* Log-Einträge - die letzten 6 werden angezeigt */}
            <div className="max-h-36 overflow-y-auto bg-gray-50 rounded border border-gray-200 p-1">
              {planningLog.slice(-6).map((log, index) => (
                <div 
                  key={index} 
                  className={`text-xs p-1 ${index === planningLog.length - 1 ? 'bg-blue-50 rounded log-highlight' : ''}`}
                >
                  <span className="text-gray-400 mr-1">{format(log.time, 'HH:mm:ss')}</span>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-sm font-medium text-gray-700">Optimierungsgewichtungen</h4>
            <button 
              onClick={() => setWeightFactors({
                startTime: 0.05,
                endTime: 0.05,
                setupTime: 0.30, // α = 0.3
                machineLoad: 0.00,
                dueDate: 0.40, // β = 0.4
                bottleneck: 0.20 // γ = 0.2
              })}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Zurücksetzen
            </button>
          </div>
          
          {/* Visualisierung der relativen Gewichtung */}
          <div className="h-4 w-full bg-gray-200 mb-4 flex rounded-full overflow-hidden">
            <div style={{width: `${weightFactors.startTime * 100}%`}} className="bg-blue-500"></div>
            <div style={{width: `${weightFactors.endTime * 100}%`}} className="bg-green-500"></div>
            <div style={{width: `${weightFactors.setupTime * 100}%`}} className="bg-yellow-500"></div>
            <div style={{width: `${weightFactors.machineLoad * 100}%`}} className="bg-purple-500"></div>
            <div style={{width: `${weightFactors.dueDate * 100}%`}} className="bg-red-500"></div>
            <div style={{width: `${weightFactors.bottleneck * 100}%`}} className="bg-orange-500"></div>
          </div>
          
          {/* Legende */}
          <div className="flex flex-wrap gap-3 mb-3 text-xs">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-blue-500 rounded-full mr-1"></div>
              <span>Frühester Start (α₁)</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-1"></div>
              <span>Frühe Fertigstellung (α₂)</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-yellow-500 rounded-full mr-1"></div>
              <span>Rüstzeitminimierung (α)</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-purple-500 rounded-full mr-1"></div>
              <span>Maschinenauslastung</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-red-500 rounded-full mr-1"></div>
              <span>Liefertermintreue (β)</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-orange-500 rounded-full mr-1"></div>
              <span>Engpassoptimierung (γ)</span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center">
                <span>Frühester Start (α₁)</span>
                <span className="inline-flex ml-1 text-blue-500" data-tooltip="Bevorzugt Maschinen, die früher mit dem Auftrag beginnen können. Ein höherer Wert führt zu einer stärkeren Gewichtung des Startzeitpunkts.">
                  ⓘ
                </span>
              </label>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.05" 
                value={weightFactors.startTime} 
                onChange={e => setWeightFactors({...weightFactors, startTime: parseFloat(e.target.value)})}
                className="w-full"
              />
              <div className="text-xs text-right">{weightFactors.startTime.toFixed(2)}</div>
            </div>
            
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center">
                <span>Frühe Fertigstellung (α₂)</span>
                <span className="inline-flex ml-1 text-blue-500" data-tooltip="Bevorzugt Maschinen, die den Auftrag früher fertigstellen können. Berücksichtigt die Gesamtdauer inklusive Bearbeitungs- und Rüstzeit.">
                  ⓘ
                </span>
              </label>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.05" 
                value={weightFactors.endTime} 
                onChange={e => setWeightFactors({...weightFactors, endTime: parseFloat(e.target.value)})}
                className="w-full"
              />
              <div className="text-xs text-right">{weightFactors.endTime.toFixed(2)}</div>
            </div>
            
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center">
                <span>Rüstzeitminimierung (α)</span>
                <span className="inline-flex ml-1 text-blue-500" data-tooltip="Bevorzugt Maschinen mit geringerem Rüstaufwand. Reduziert unproduktive Rüstzeiten und erhöht die Effizienz der Produktion. Empfehlung: 0,30">
                  ⓘ
                </span>
              </label>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.05" 
                value={weightFactors.setupTime} 
                onChange={e => setWeightFactors({...weightFactors, setupTime: parseFloat(e.target.value)})}
                className="w-full"
              />
              <div className="text-xs text-right">{weightFactors.setupTime.toFixed(2)}</div>
            </div>
            
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center">
                <span>Maschinenauslastung</span>
                <span className="inline-flex ml-1 text-blue-500" data-tooltip="Bevorzugt weniger ausgelastete Maschinen. Sorgt für eine ausgewogene Verteilung der Arbeitslast auf alle verfügbaren Maschinen.">
                  ⓘ
                </span>
              </label>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.05" 
                value={weightFactors.machineLoad} 
                onChange={e => setWeightFactors({...weightFactors, machineLoad: parseFloat(e.target.value)})}
                className="w-full"
              />
              <div className="text-xs text-right">{weightFactors.machineLoad.toFixed(2)}</div>
            </div>
            
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center">
                <span>Liefertermin (β)</span>
                <span className="inline-flex ml-1 text-blue-500" data-tooltip="Bevorzugt Aufträge, die ihren Liefertermin einhalten können. Höhere Werte priorisieren die Termintreue stärker. Empfehlung: 0,40">
                  ⓘ
                </span>
              </label>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.05" 
                value={weightFactors.dueDate} 
                onChange={e => setWeightFactors({...weightFactors, dueDate: parseFloat(e.target.value)})}
                className="w-full"
              />
              <div className="text-xs text-right">{weightFactors.dueDate.toFixed(2)}</div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center">
                <span>Engpassoptimierung (γ)</span>
                <span className="inline-flex ml-1 text-blue-500" data-tooltip="Optimiert die Auslastung von Engpassmaschinen. Höhere Werte führen zu einer besseren Verteilung der Last auf Engpässen. Empfehlung: 0,20">
                  ⓘ
                </span>
              </label>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.05" 
                value={weightFactors.bottleneck} 
                onChange={e => setWeightFactors({...weightFactors, bottleneck: parseFloat(e.target.value)})}
                className="w-full"
              />
              <div className="text-xs text-right">{weightFactors.bottleneck.toFixed(2)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Zusammenfassung der Planungsergebnisse */}
      {schedule.length > 0 && (
        <div className="mb-6 p-4 bg-gray-50 rounded-md">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Planungsergebnisse</h3>
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <div className="text-sm text-gray-500">Make to Order</div>
              <div className="font-medium">{planningResults.makeToOrderOrders}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Make to Stock</div>
              <div className="font-medium">{planningResults.makeToStockOrders}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Gesamt-Rüstzeit</div>
              <div className="font-medium">{formatDuration(planningResults.totalSetupTime)}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Gesamt-Bearbeitungszeit</div>
              <div className="font-medium">{formatDuration(planningResults.totalProcessingTime)}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Ende der Planung</div>
              <div className="font-medium">{formatDateFromMinutes(planningResults.scheduleEndTime)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Neues Panel für detaillierte Auftragsübersicht */}
      {schedule.length > 0 && (
        <div className="order-details-panel mb-6">
          <div className="order-details-header">
            <h3>Auftragsdetails</h3>
            <div className="text-sm text-gray-500">
              {orders.length} Aufträge insgesamt
            </div>
          </div>
          <div className="order-details-body">
            <div className="order-details-grid">
              {orders.map(order => {
                // Finde alle Slots, die zu diesem Auftrag gehören
                const orderSlots = schedule
                  .flatMap(machine => machine.slots)
                  .filter(slot => slot.orderName === order.name);
                
                // Berechne den frühesten Start und spätesten Endzeitpunkt
                const earliestStart = orderSlots.length > 0 
                  ? Math.min(...orderSlots.map(s => s.start)) 
                  : 0;
                const latestEnd = orderSlots.length > 0 
                  ? Math.max(...orderSlots.map(s => s.end)) 
                  : 0;
                
                // Berechne, ob der Auftrag früher, rechtzeitig oder verspätet fertig wird
                const endDate = new Date(new Date(startDate).getTime() + latestEnd * 60 * 1000);
                const dueDate = new Date(order.dueDate);
                const timeDiff = endDate.getTime() - dueDate.getTime();
                const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
                
                let status = "ontime";
                let statusText = "Pünktliche Fertigstellung";
                
                if (daysDiff > 0) {
                  status = "late";
                  statusText = `${daysDiff} ${daysDiff === 1 ? 'Tag' : 'Tage'} verspätet`;
                } else if (daysDiff < -1) {
                  status = "early";
                  statusText = `${Math.abs(daysDiff)} Tage früher fertig`;
                }
                
                // Berechne Gesamtrüstzeit und Bearbeitungszeit
                const setupTime = orderSlots.reduce((sum, slot) => sum + slot.setupTime, 0);
                const processingTime = orderSlots.reduce((sum, slot) => sum + slot.processingTime, 0);
                
                return (
                  <div key={order.id} className="order-detail-card">
                    <div className="order-detail-card-header">
                      <span className="order-name">{order.name}</span>
                      <span 
                        className={`order-type-badge ${order.type === 'Make to Stock' ? 'mts' : 'mto'}`}
                      >
                        {order.type === 'Make to Stock' ? 'MTS' : 'MTO'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600">
                      TN: {order.partNumber} | RMN: {order.reportNumber} | Losgröße: {order.lotSize}
                    </div>
                    <div className="order-timing">
                      <div className="order-timing-item">
                        <span className="order-timing-label">Startzeit:</span>
                        <span className="order-timing-value">
                          {earliestStart > 0 ? formatDateFromMinutes(earliestStart) : "Nicht geplant"}
                        </span>
                      </div>
                      <div className="order-timing-item">
                        <span className="order-timing-label">Endzeit:</span>
                        <span className="order-timing-value">
                          {latestEnd > 0 ? formatDateFromMinutes(latestEnd) : "Nicht geplant"}
                        </span>
                      </div>
                      <div className="order-timing-item">
                        <span className="order-timing-label">Due Date:</span>
                        <span className="order-timing-value">
                          {format(dueDate, 'dd.MM.yyyy', { locale: de })}
                        </span>
                      </div>
                      <div className="order-timing-item">
                        <span className="order-timing-label">Gesamtdauer:</span>
                        <span className="order-timing-value">
                          {formatDuration(processingTime + setupTime)}
                        </span>
                      </div>
                    </div>
                    <div className="order-status">
                      <div className={`order-status-indicator order-status-${status}`}></div>
                      <span>{statusText}</span>
                    </div>
                    <div className="order-meta">
                      <span>Rüstzeit: {formatDuration(setupTime)}</span>
                      <span>Bearbeitungszeit: {formatDuration(processingTime)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Visualisierung der Maschinenbelegung mit verschiedenen Ansichtsoptionen */}
      {schedule.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-medium text-gray-900 mb-3">
            Maschinenbelegung
          </h3>
          
          {/* Ansichts-Umschalter */}
          <div className="view-switcher mb-4">
            <button
              className={`view-switcher-btn ${viewMode === 'gantt' ? 'active' : ''}`}
              onClick={() => setViewMode('gantt')}
            >
              Gantt-Diagramm
            </button>
            <button
              className={`view-switcher-btn ${viewMode === 'timeline' ? 'active' : ''}`}
              onClick={() => setViewMode('timeline')}
            >
              Zeitleisten
            </button>
            <button
              className={`view-switcher-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
            >
              Tabelle
            </button>
          </div>
          
          {/* Gantt-Diagramm Ansicht - Tagesbasierte übersichtliche Visualisierung */}
          {viewMode === 'gantt' && (
            <ImprovedGanttChart
              schedule={schedule}
              orders={orders}
              startDate={startDate}
              formatDuration={formatDuration}
              bottleneckGroups={bottleneckGroups}
            />
          )}
          
          {/* Zeitleisten-Ansicht - Detaillierte visuelle Darstellung mit Zeitstrahlen */}
          {viewMode === 'timeline' && renderAdvancedMachineSchedule()}
          
          {/* Tabellen-Ansicht - Detaillierte numerische Darstellung der Zeitplanung */}
          {viewMode === 'table' && (
            <div className="grid gap-4">
              {schedule.map((machineSchedule, idx) => {
                // Maximale Endzeit für diese Maschine finden
                const maxEnd = machineSchedule.slots.reduce((max, slot) => Math.max(max, slot.end), 0);
                
                return (
                  <div key={idx} className="border rounded-lg p-4">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-medium text-gray-800">
                        {machineSchedule.machineName} (ID: {machineSchedule.machineId})
                      </h4>
                      <span className="text-sm text-gray-500">
                        Auslastung bis: {formatDateFromMinutes(maxEnd)}
                      </span>
                    </div>
                    
                    {/* Detaillierte Auflistung der Slots */}
                    <div className="mt-2 overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Auftrag</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Teilenummer</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rückmeldenummer</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Start</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ende</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rüstzeit</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bearbeitungszeit</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {machineSchedule.slots.map((slot, slotIdx) => (
                            <tr key={slotIdx}>
                              <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900">{slot.orderName}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{slot.partNumber}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{slot.reportNumber}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{formatDateFromMinutes(slot.start)}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{formatDateFromMinutes(slot.end)}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{formatDuration(slot.setupTime)}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{formatDuration(slot.processingTime)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OrderScheduling;