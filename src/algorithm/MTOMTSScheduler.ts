// MTOMTSScheduler.ts
// Enthält die zwei-Phasen Algorithmus-Implementierung für die Reihenfolgeplanung mit MTO/MTS-Aufträgen

// Typdefinitionen
type OrderType = 'Make to Stock' | 'Make to Order';

interface ProductionOrder {
  id: number;
  name: string;
  partNumber: string;     // Teilenummer
  reportNumber: string;   // Rückmeldenummer
  type: OrderType;
  lotSize: number;
  dueDate: string;
}

interface Matrix {
  [from: string]: { [to: string]: number };
}

interface MachineGroup {
  id: number;
  name: string;
  description: string;
}

interface Machine {
  id: number;
  name: string;
  description: string;
  groupId: number;               
  capablePartNumbers: string[];  
}

interface ProductionRoute {
  partNumber: string;     
  productName?: string;   
  sequence: number[];     
}

interface ScheduleItem {
  orderName: string;
  partNumber: string;
  reportNumber: string;
  machineId: number;
  start: number;
  end: number;
  setupTime: number;
  processingTime: number;
  type: OrderType; // Typ des Auftrags für die visuelle Unterscheidung
}

interface MachineSchedule {
  machineId: number;
  machineName: string;
  slots: ScheduleItem[];
}

interface OptimizationWeights {
  startTime: number;     // Gewichtung für frühen Startzeitpunkt
  endTime: number;       // Gewichtung für frühe Fertigstellung
  setupTime: number;     // Gewichtung für geringen Rüstzeitanteil
  machineLoad: number;   // Gewichtung für niedrige Maschinenauslastung
  dueDate: number;       // Gewichtung für Liefertermintreue
  bottleneck: number;    // Gewichtung für Engpass-Vermeidung (neu)
}

interface ScheduleResult {
  schedules: MachineSchedule[];
  totalDuration: number;
  makeToStockOrders: number;
  makeToOrderOrders: number;
  totalSetupTime: number;
  totalProcessingTime: number;
  scheduleEndTime: number;
}

// Utility-Funktionen für den Scheduler
class MTOMTSScheduler {
  private orders: ProductionOrder[];
  private setupMatrix: Matrix;
  private cycleMatrix: Matrix;
  private machines: Machine[];
  private machineGroups: MachineGroup[];
  private routes: ProductionRoute[];
  private weights: OptimizationWeights;
  private addLogCallback: (message: string) => void;

  // Cache für Berechnungen
  private bottleneckGroupsCache: Map<number, number> = new Map();
  private machineLoadsCache: Map<number, number> = new Map();

  constructor(
    orders: ProductionOrder[],
    setupMatrix: Matrix,
    cycleMatrix: Matrix,
    machines: Machine[],
    machineGroups: MachineGroup[],
    routes: ProductionRoute[],
    weights: OptimizationWeights,
    addLogCallback: (message: string) => void
  ) {
    this.orders = orders;
    this.setupMatrix = setupMatrix;
    this.cycleMatrix = cycleMatrix;
    this.machines = machines;
    this.machineGroups = machineGroups;
    this.routes = routes;
    this.weights = weights;
    this.addLogCallback = addLogCallback;
  }

  // Hauptfunktion: Generiert den optimierten Zeitplan
  public generateOptimizedSchedule = async (): Promise<ScheduleResult> => {
    this.addLog("Starte zwei-Phasen Reihenfolgeplanung...");
    
    // 0. Teile die Aufträge nach Typ auf
    const mtoOrders = this.orders.filter(order => order.type === 'Make to Order');
    const mtsOrders = this.orders.filter(order => order.type === 'Make to Stock');
    
    // Statistiken für die Ergebnisse
    let makeToStockCount = mtsOrders.length;
    let makeToOrderCount = mtoOrders.length;
    let totalSetupTime = 0;
    let totalProcessingTime = 0;
    let maxEndTime = 0;
    
    // Leeres Schedule initialisieren
    let machineSchedules: MachineSchedule[] = [];

    // 1. Phase: Optimiere die Reihenfolge der MTS-Aufträge mit Greedy + Simulated Annealing
    if (mtsOrders.length > 0) {
      this.addLog(`Phase 1: Optimiere ${mtsOrders.length} Make-to-Stock Aufträge...`);
      
      // 1.1 Greedy-Algorithmus für MTS-Aufträge
      this.addLog("Erstelle initiale Lösung mit Greedy-Algorithmus...");
      machineSchedules = await this.createGreedyMTSSchedule(mtsOrders);
      
      // 1.2 Simulated Annealing für weitere Optimierung
      if (mtsOrders.length > 1) {
        this.addLog("Optimiere Basis-Sequenz mit Simulated Annealing...");
        machineSchedules = await this.optimizeWithSimulatedAnnealing(machineSchedules, mtsOrders);
      }
    }

    // 2. Phase: Integration der MTO-Aufträge an optimalen Positionen
    if (mtoOrders.length > 0) {
      this.addLog(`Phase 2: Integriere ${mtoOrders.length} Make-to-Order Aufträge in die Sequenz...`);
      
      // 2.1 Sortiere MTO-Aufträge nach Priorität (Fälligkeitsdatum)
      const sortedMTOOrders = [...mtoOrders].sort((a, b) => 
        new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      );
      
      // 2.2 Füge jeden MTO-Auftrag an der optimalen Position im Schedule ein
      for (const order of sortedMTOOrders) {
        this.addLog(`Integriere MTO-Auftrag: ${order.name} (${order.partNumber})`);
        machineSchedules = await this.integrateMTOOrder(machineSchedules, order);
      }
    }
    
    // 3. Nachbearbeitung und Statistik-Berechnung
    this.addLog("Berechne finale Statistiken...");
    
    // Berechne Gesamtstatistiken
    machineSchedules.forEach(machine => {
      machine.slots.forEach(slot => {
        totalSetupTime += slot.setupTime;
        totalProcessingTime += slot.processingTime;
        // Aktualisiere die maximale Endzeit
        maxEndTime = Math.max(maxEndTime, slot.end);
      });
    });
    
    // Sortiere nach Maschinen-ID für konsistente Ausgabe
    machineSchedules.sort((a, b) => a.machineId - b.machineId);
    
    this.addLog(`Reihenfolgeplanung abgeschlossen - ${makeToStockCount} MTS, ${makeToOrderCount} MTO Aufträge`);
    
    return {
      schedules: machineSchedules,
      totalDuration: maxEndTime,
      makeToStockOrders: makeToStockCount,
      makeToOrderOrders: makeToOrderCount,
      totalSetupTime,
      totalProcessingTime,
      scheduleEndTime: maxEndTime
    };
  }

  // Phase 1.1: Erstellt einen initialen Zeitplan für MTS-Aufträge mit Greedy-Algorithmus
  private createGreedyMTSSchedule = async (mtsOrders: ProductionOrder[]): Promise<MachineSchedule[]> => {
    let machineSchedules: MachineSchedule[] = [];
    
    // Identifiziere Engpass-Maschinengruppen
    const bottleneckGroups = this.identifyBottleneckGroups();
    this.addLog(`Identifizierte ${bottleneckGroups.length} potenzielle Engpass-Maschinengruppen`);
    
    // Sortiere nach aufsteigender Rüstzeit und absteigender Prozesszeit
    const sortedOrders = [...mtsOrders].sort((a, b) => {
      // Berechne durchschnittliche Rüstzeiten
      const avgSetupTimeA = this.calculateAverageSetupTime(a.partNumber);
      const avgSetupTimeB = this.calculateAverageSetupTime(b.partNumber);
      
      // Berechne Prozesszeiten (für die erste Maschine in der Route als Vereinfachung)
      const processingTimeA = this.calculateProcessingTime(a.partNumber, a.lotSize);
      const processingTimeB = this.calculateProcessingTime(b.partNumber, b.lotSize);
      
      // Priorität auf Rüstzeit, dann auf längere Prozesszeit
      if (avgSetupTimeA !== avgSetupTimeB) {
        return avgSetupTimeA - avgSetupTimeB; // Aufträge mit geringerer Rüstzeit zuerst
      } else {
        return processingTimeB - processingTimeA; // Längere Aufträge zuerst
      }
    });
    
    // Füge jeden Auftrag dem Schedule hinzu
    for (let i = 0; i < sortedOrders.length; i++) {
      const order = sortedOrders[i];
      this.addLog(`Greedy-Planung: Verarbeite Auftrag ${order.name} (${order.partNumber})`);
      
      const route = this.findRouteForOrder(order.partNumber);
      if (!route) {
        this.addLog(`⚠️ Keine Fertigungsroute für ${order.name} gefunden!`);
        continue;
      }
      
      const { schedules, totalDuration } = this.findOptimalStartTimeForRoute(
        route, 
        order,
        machineSchedules
      );
      
      machineSchedules = schedules;
      this.addLog(`Auftrag ${order.name} eingeplant. Dauer: ${totalDuration} Min.`);
      
      // Kurze Pause für die Animation und UI-Updates
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return machineSchedules;
  }

  // Phase 1.2: Optimiert den MTS-Zeitplan mit Simulated Annealing
  private optimizeWithSimulatedAnnealing = async (
    initialSchedules: MachineSchedule[],
    mtsOrders: ProductionOrder[]
  ): Promise<MachineSchedule[]> => {
    // Parameter für das Simulated Annealing
    let currentTemperature = 1000.0;
    const coolingRate = 0.95;
    const minTemperature = 1.0;
    const iterationsPerTemperature = Math.min(10, Math.max(2, Math.floor(mtsOrders.length / 2)));
    
    // Aktuelle beste Lösung
    let currentSchedule = this.deepCloneSchedule(initialSchedules);
    let currentScore = this.evaluateScheduleQuality(currentSchedule);
    
    // Beste gefundene Lösung
    let bestSchedule = this.deepCloneSchedule(currentSchedule);
    let bestScore = currentScore;
    
    this.addLog(`Simulated Annealing gestartet mit Temperatur ${currentTemperature}`);
    this.addLog(`Initiale Bewertung: ${currentScore.toFixed(2)}`);
    
    // Hauptschleife des Simulated Annealing
    let iteration = 0;
    while (currentTemperature > minTemperature) {
      for (let i = 0; i < iterationsPerTemperature; i++) {
        // Generiere einen Nachbarzustand durch zufälliges Vertauschen von zwei Aufträgen
        const neighborSchedule = this.generateNeighborSchedule(currentSchedule);
        const neighborScore = this.evaluateScheduleQuality(neighborSchedule);
        
        // Berechne den Qualitätsunterschied
        const scoreDelta = neighborScore - currentScore;
        
        // Entscheide, ob der Nachbarzustand akzeptiert wird
        if (scoreDelta > 0) {
          // Bessere Lösung gefunden, immer akzeptieren
          currentSchedule = this.deepCloneSchedule(neighborSchedule);
          currentScore = neighborScore;
          
          // Prüfe, ob es die bisher beste Lösung ist
          if (currentScore > bestScore) {
            bestSchedule = this.deepCloneSchedule(currentSchedule);
            bestScore = currentScore;
            this.addLog(`Neue beste Lösung gefunden! Bewertung: ${bestScore.toFixed(2)}`);
          }
        } else {
          // Schlechtere Lösung, akzeptiere mit einer bestimmten Wahrscheinlichkeit
          const acceptanceProbability = Math.exp(scoreDelta / currentTemperature);
          if (Math.random() < acceptanceProbability) {
            currentSchedule = this.deepCloneSchedule(neighborSchedule);
            currentScore = neighborScore;
          }
        }
        
        iteration++;
        // Kurze Pause alle 10 Iterationen für die UI-Aktualisierung
        if (iteration % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      // Abkühlen der Temperatur
      currentTemperature *= coolingRate;
      this.addLog(`Temperatur: ${currentTemperature.toFixed(2)}, Bewertung: ${bestScore.toFixed(2)}`);
    }
    
    this.addLog(`Simulated Annealing abgeschlossen nach ${iteration} Iterationen`);
    this.addLog(`Finale Bewertung: ${bestScore.toFixed(2)} (Verbesserung um ${(bestScore - this.evaluateScheduleQuality(initialSchedules)).toFixed(2)})`);
    
    return bestSchedule;
  }

  // Phase 2: Integration eines MTO-Auftrags an der optimalen Position im Schedule
  private integrateMTOOrder = async (
    currentSchedules: MachineSchedule[],
    mtoOrder: ProductionOrder
  ): Promise<MachineSchedule[]> => {
    const route = this.findRouteForOrder(mtoOrder.partNumber);
    if (!route) {
      this.addLog(`⚠️ Keine Fertigungsroute für MTO-Auftrag ${mtoOrder.name} gefunden!`);
      return currentSchedules;
    }
    
    // Finde den frühestmöglichen Startzeitpunkt basierend auf dem Due Date
    const dueDate = new Date(mtoOrder.dueDate).getTime();
    const latestPossibleEndTime = this.calculateLatestEndTime(mtoOrder, route);
    
    // Finde den optimalen Platz für den MTO-Auftrag
    const { schedules, totalDuration } = this.findOptimalStartTimeForMTOOrder(
      route, 
      mtoOrder,
      currentSchedules,
      latestPossibleEndTime
    );
    
    this.addLog(`MTO-Auftrag ${mtoOrder.name} eingeplant. Dauer: ${totalDuration} Min.`);
    
    // Kurze Pause für die Animation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return schedules;
  }

  // Hilfsfunktion: Bewertet die Qualität eines Zeitplans
  private evaluateScheduleQuality = (machineSchedules: MachineSchedule[]): number => {
    // Verschiedene Kriterien für die Bewertung
    let totalSetupTime = 0;
    let totalProcessingTime = 0;
    let totalMakespan = 0;
    let totalLateness = 0;
    let totalMachineUtilization = 0;
    let bottleneckUtilization = 0;
    
    // Bottleneck-Gruppen identifizieren
    const bottleneckGroups = this.identifyBottleneckGroups();
    
    // Berechne die Statistiken für den Zeitplan
    machineSchedules.forEach(machineSchedule => {
      const machineId = machineSchedule.machineId;
      const machine = this.machines.find(m => m.id === machineId);
      
      if (!machine) return;
      
      const isBottleneck = bottleneckGroups.includes(machine.groupId);
      let machineEndTime = 0;
      
      machineSchedule.slots.forEach(slot => {
        // Grundlegende Zeitmetriken
        totalSetupTime += slot.setupTime;
        totalProcessingTime += slot.processingTime;
        
        // Berechne Lateness (Verspätung)
        const order = this.orders.find(o => o.name === slot.orderName);
        if (order) {
          const dueDate = new Date(order.dueDate).getTime();
          const endTime = slot.end * 60 * 1000; // Konvertiere in Millisekunden
          
          if (endTime > dueDate) {
            totalLateness += (endTime - dueDate) / (60 * 1000); // Zurück in Minuten
          }
        }
        
        // Aktualisiere die maximale Endzeit der Maschine
        machineEndTime = Math.max(machineEndTime, slot.end);
      });
      
      // Aktualisiere den Gesamtmakespan
      totalMakespan = Math.max(totalMakespan, machineEndTime);
      
      // Berechne Maschinenauslastung
      const machineLoad = this.calculateMachineLoad(machineId, machineSchedules);
      totalMachineUtilization += machineLoad;
      
      // Erhöhe Bottleneck-Gewicht, wenn es sich um eine Engpass-Maschine handelt
      if (isBottleneck) {
        bottleneckUtilization += machineLoad;
      }
    });
    
    // Verbesserte Normalisierung: Referenzwerte für die Normalisierung berechnen
    // Diese ermöglichen eine bessere Vergleichbarkeit der verschiedenen Kriterien
    const totalTasks = machineSchedules.reduce((count, machine) => count + machine.slots.length, 0);
    const avgJobDuration = (totalSetupTime + totalProcessingTime) / Math.max(1, totalTasks);
    
    // Normalisierung der Kriterien auf vergleichbare Wertebereiche (0-1)
    const normalizedMakespan = totalMakespan / Math.max(1, (totalTasks * avgJobDuration)); // Normalisiert auf durchschnittliche Job-Dauer
    const normalizedSetupRatio = totalSetupTime / Math.max(1, totalSetupTime + totalProcessingTime); // Bereits im Bereich 0-1
    const normalizedLateness = Math.min(1, totalLateness / Math.max(1, totalTasks * avgJobDuration)); // Normalisiert auf durchschnittliche Job-Dauer, begrenzt auf 1
    
    // Maschinenlastverteilung
    const avgMachineUtilization = totalMachineUtilization / Math.max(1, machineSchedules.length);
    
    // Engpass-Auslastung: Wenn zu hoch, ist es schlecht - wenn zu niedrig, wird Kapazität verschwendet
    // Ideale Engpassauslastung liegt bei ca. 80-90%
    const avgBottleneckUtilization = bottleneckUtilization / Math.max(1, bottleneckGroups.length);
    // Optimaler Wert für Engpass-Auslastung (ca. 85%)
    const optimalBottleneckUtilization = 0.85;
    // Abweichung vom optimalen Wert (0 ist am besten, 1 ist am schlechtesten)
    const bottleneckDeviationFromOptimum = Math.abs(avgBottleneckUtilization - optimalBottleneckUtilization) / optimalBottleneckUtilization;
    const normalizedBottleneckUtilization = Math.min(1, bottleneckDeviationFromOptimum);
    
    this.addLog(`Bewertungskriterien: 
      Makespan: ${normalizedMakespan.toFixed(3)}, 
      Rüstanteil: ${normalizedSetupRatio.toFixed(3)}, 
      Verspätung: ${normalizedLateness.toFixed(3)}, 
      Maschinenauslastung: ${avgMachineUtilization.toFixed(3)}, 
      Engpass-Abweichung: ${normalizedBottleneckUtilization.toFixed(3)}`);
    
    // Gewichtete Bewertungsfunktion (höher ist besser)
    return (
      -this.weights.endTime * normalizedMakespan +            // Kürzerer Makespan
      -this.weights.setupTime * normalizedSetupRatio +        // Geringerer Rüstanteil (α)
      -this.weights.dueDate * normalizedLateness +            // Weniger Verspätung (β)
      -this.weights.machineLoad * avgMachineUtilization +     // Ausgewogenere Auslastung
      -this.weights.bottleneck * normalizedBottleneckUtilization // Bessere Engpass-Nutzung (γ)
    );
  }

  // Hilfsfunktion: Identifiziert Engpass-Maschinengruppen
  private identifyBottleneckGroups = (): number[] => {
    // Berechne Kapazitätsanforderungen für jede Maschinengruppe
    const groupLoads = new Map<number, number>();
    const groupCapacities = new Map<number, number>();
    const groupSetupTimes = new Map<number, number>();  // Neue Map für Rüstzeiten pro Gruppe
    const groupFrequency = new Map<number, number>();   // Wie oft wird die Gruppe in Routen verwendet
    
    // Initialisiere die Kapazitäten (Anzahl der Maschinen pro Gruppe)
    this.machineGroups.forEach(group => {
      const machinesInGroup = this.machines.filter(m => m.groupId === group.id).length;
      groupCapacities.set(group.id, machinesInGroup);
      groupLoads.set(group.id, 0);
      groupSetupTimes.set(group.id, 0);
      groupFrequency.set(group.id, 0);
    });
    
    // Erweiterte Analyse: Berechne den Bedarf pro Gruppe basierend auf mehreren Faktoren
    this.orders.forEach(order => {
      const route = this.findRouteForOrder(order.partNumber);
      if (route) {
        // Für jede Maschinengruppe in der Route
        route.sequence.forEach((groupId, index) => {
          // Prozesszeit basierend auf der Losgröße
          const processingTime = this.calculateProcessingTime(order.partNumber, order.lotSize);
          
          // Erhöhe die Last der Gruppe
          const currentLoad = groupLoads.get(groupId) || 0;
          groupLoads.set(groupId, currentLoad + processingTime);
          
          // Erhöhe die Nutzungshäufigkeit dieser Gruppe
          const currentFreq = groupFrequency.get(groupId) || 0;
          groupFrequency.set(groupId, currentFreq + 1);
          
          // Schätze die durchschnittliche Rüstzeit für diese Gruppe
          // Dies ist eine vereinfachte Heuristik, da wir nicht alle Übergänge kennen
          if (index > 0) {
            const prevGroupId = route.sequence[index - 1];
            // Schätze die Rüstzeit zwischen verschiedenen Teilenummern in dieser Gruppe ab
            const setupTimeEstimate = this.calculateAverageSetupTime(order.partNumber);
            const currentSetupTime = groupSetupTimes.get(groupId) || 0;
            groupSetupTimes.set(groupId, currentSetupTime + setupTimeEstimate);
          }
        });
      }
    });
    
    // Berechne einen Engpass-Score für jede Gruppe basierend auf mehreren Faktoren
    const groupBottleneckScores = new Map<number, number>();
    
    this.addLog("Berechne Engpass-Scores für Maschinengruppen:");
    
    groupLoads.forEach((load, groupId) => {
      const capacity = groupCapacities.get(groupId) || 1;
      const setupTime = groupSetupTimes.get(groupId) || 0;
      const frequency = groupFrequency.get(groupId) || 0;
      
      // Grundauslastung (Last/Kapazität)
      const utilization = load / capacity;
      
      // Frequenz-Faktor: Wie oft wird diese Gruppe im Gesamtprozess benötigt?
      // Mehr Nutzung = höheres Engpotential
      const frequencyFactor = Math.log(frequency + 1) / Math.log(10); // Logarithmischer Faktor (0-1)
      
      // Rüstzeitfaktor: Engpässe haben oft hohe Rüstzeiten
      const setupFactor = setupTime / Math.max(1, load); // Rüstzeit als Anteil der Gesamtlast
      
      // Kombinierter Engpass-Score (gewichtet)
      const bottleneckScore = (
        utilization * 0.6 +      // Auslastung hat den größten Einfluss
        frequencyFactor * 0.3 +  // Nutzungshäufigkeit
        setupFactor * 0.1        // Rüstzeitanteil
      );
      
      groupBottleneckScores.set(groupId, bottleneckScore);
      
      // Cache-Aktualisierung für schnelleren Zugriff
      this.bottleneckGroupsCache.set(groupId, bottleneckScore);
      
      const group = this.machineGroups.find(g => g.id === groupId);
      this.addLog(`Gruppe ${group?.name || groupId}: Score ${bottleneckScore.toFixed(3)} (Auslastung: ${utilization.toFixed(2)}, Häufigkeit: ${frequency}, Rüstanteil: ${setupFactor.toFixed(2)})`);
    });
    
    // Sortiere die Gruppen nach absteigendem Engpass-Score
    const sortedGroups = Array.from(groupBottleneckScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);
    
    // Adaptive Auswahl der Engpässe basierend auf einem Score-Threshold
    // Wähle Gruppen mit einem Score > 60% des maximalen Scores
    const maxScore = Math.max(...Array.from(groupBottleneckScores.values()));
    const threshold = maxScore * 0.6;
    
    const bottleneckGroups = sortedGroups.filter(groupId => 
      (groupBottleneckScores.get(groupId) || 0) >= threshold
    );
    
    // Mindestens eine Engpass-Gruppe, maximal 30% aller Gruppen
    const numBottlenecks = Math.max(
      1, 
      Math.min(
        bottleneckGroups.length,
        Math.ceil(sortedGroups.length * 0.3)
      )
    );
    
    const result = sortedGroups.slice(0, numBottlenecks);
    
    // Protokolliere die identifizierten Engpässe
    const engpassNamen = result.map(id => {
      const group = this.machineGroups.find(g => g.id === id);
      return group ? group.name : `Gruppe ${id}`;
    }).join(", ");
    
    this.addLog(`Identifizierte Engpassgruppen: ${engpassNamen}`);
    
    return result;
  }

  // Hilfsfunktion: Generiert einen Nachbarzustand für Simulated Annealing
  private generateNeighborSchedule = (currentSchedules: MachineSchedule[]): MachineSchedule[] => {
    // Tiefe Kopie des aktuellen Zeitplans erstellen
    const newSchedules = this.deepCloneSchedule(currentSchedules);
    
    // Wir können zwei Arten von Änderungen vornehmen:
    // 1. Vertausche zwei Aufträge auf der gleichen Maschine
    // 2. Verschiebe einen Auftrag auf eine andere kompatible Maschine
    
    if (Math.random() < 0.7) { // 70% Wahrscheinlichkeit für Option 1
      // Wähle zufällig eine Maschine mit mindestens 2 Slots
      const candidateMachines = newSchedules.filter(m => m.slots.length >= 2);
      
      if (candidateMachines.length === 0) {
        return newSchedules; // Keine geeignete Maschine gefunden
      }
      
      const randomMachine = candidateMachines[Math.floor(Math.random() * candidateMachines.length)];
      
      // Wähle zwei zufällige Positionen zum Vertauschen
      const idx1 = Math.floor(Math.random() * randomMachine.slots.length);
      let idx2 = Math.floor(Math.random() * randomMachine.slots.length);
      
      // Stelle sicher, dass idx2 nicht gleich idx1 ist
      while (idx2 === idx1 && randomMachine.slots.length > 1) {
        idx2 = Math.floor(Math.random() * randomMachine.slots.length);
      }
      
      if (idx1 !== idx2) {
        // Tausche die Slots
        const temp = randomMachine.slots[idx1];
        randomMachine.slots[idx1] = randomMachine.slots[idx2];
        randomMachine.slots[idx2] = temp;
        
        // Aktualisiere die Start- und Endzeiten nach dem Tausch
        this.recalculateSlotTimesForMachine(randomMachine);
      }
    } else { // 30% Wahrscheinlichkeit für Option 2
      // Wähle zufällig eine Maschine mit mindestens 1 Slot
      const candidateMachines = newSchedules.filter(m => m.slots.length >= 1);
      
      if (candidateMachines.length <= 1) {
        return newSchedules; // Nicht genug Maschinen für Verschiebung
      }
      
      const randomSourceMachine = candidateMachines[Math.floor(Math.random() * candidateMachines.length)];
      const randomSlotIdx = Math.floor(Math.random() * randomSourceMachine.slots.length);
      const slotToMove = randomSourceMachine.slots[randomSlotIdx];
      
      // Finde andere kompatible Maschinen für diesen Auftrag
      const order = this.orders.find(o => o.name === slotToMove.orderName);
      
      if (order) {
        const route = this.findRouteForOrder(order.partNumber);
        
        if (route) {
          // Finde die Maschinengruppe, aus der der Auftrag verschoben wird
          const sourceMachine = this.machines.find(m => m.id === randomSourceMachine.machineId);
          
          if (sourceMachine) {
            const sourceGroupId = sourceMachine.groupId;
            
            // Finde andere Maschinen in derselben Gruppe, die diesen Auftrag bearbeiten können
            const compatibleMachines = this.machines.filter(m => 
              m.id !== randomSourceMachine.machineId &&
              m.groupId === sourceGroupId &&
              m.capablePartNumbers.includes(order.partNumber)
            );
            
            if (compatibleMachines.length > 0) {
              // Wähle eine zufällige kompatible Maschine
              const targetMachine = compatibleMachines[Math.floor(Math.random() * compatibleMachines.length)];
              
              // Finde oder erstelle den Schedule für die Zielmaschinme
              let targetMachineSchedule = newSchedules.find(ms => ms.machineId === targetMachine.id);
              
              if (!targetMachineSchedule) {
                // Erstelle einen neuen Schedule für die Zielmaschine
                targetMachineSchedule = {
                  machineId: targetMachine.id,
                  machineName: targetMachine.name,
                  slots: []
                };
                newSchedules.push(targetMachineSchedule);
              }
              
              // Entferne den Slot aus der Quellmaschine
              randomSourceMachine.slots.splice(randomSlotIdx, 1);
              
              // Füge den Slot zur Zielmaschine hinzu
              targetMachineSchedule.slots.push(slotToMove);
              
              // Aktualisiere die Zeiten für beide Maschinen
              this.recalculateSlotTimesForMachine(randomSourceMachine);
              this.recalculateSlotTimesForMachine(targetMachineSchedule);
            }
          }
        }
      }
    }
    
    return newSchedules;
  }

  // Hilfsfunktion: Neuberechnung der Slot-Zeiten für eine Maschine
  private recalculateSlotTimesForMachine = (machineSchedule: MachineSchedule): void => {
    if (machineSchedule.slots.length === 0) return;
    
    // Sortieren der Slots nach ihrer Position (keine Zeitänderung)
    machineSchedule.slots.sort((a, b) => a.start - b.start);
    
    // Der erste Slot beginnt bei 0 oder seiner aktuellen Startzeit
    let previousSlot: ScheduleItem | null = null;
    
    for (const slot of machineSchedule.slots) {
      if (previousSlot === null) {
        // Erster Slot - Start bleibt unverändert
        slot.end = slot.start + slot.setupTime + slot.processingTime;
      } else {
        // Nachfolgende Slots - müssen nach dem vorherigen Slot beginnen
        // Rüstzeit zwischen vorherigem und aktuellem Produkt berechnen
        const setupTime = this.calculateSetupTime(previousSlot.partNumber, slot.partNumber);
        
        // Aktualisiere den Slot
        slot.start = previousSlot.end;
        slot.setupTime = setupTime;
        slot.end = slot.start + slot.setupTime + slot.processingTime;
      }
      
      previousSlot = slot;
    }
  }

  // Hilfsfunktion: Erstellt eine tiefe Kopie des Schedules
  private deepCloneSchedule = (schedules: MachineSchedule[]): MachineSchedule[] => {
    return JSON.parse(JSON.stringify(schedules));
  }

  // Hilfsfunktion: Berechnet die durchschnittliche Rüstzeit für ein Produkt
  private calculateAverageSetupTime = (partNumber: string): number => {
    if (!this.setupMatrix[partNumber]) return 0;
    
    const setupTimes = Object.values(this.setupMatrix[partNumber]);
    if (setupTimes.length === 0) return 0;
    
    const sum = setupTimes.reduce((acc, val) => acc + val, 0);
    return sum / setupTimes.length;
  }

  // Berechne den spätestmöglichen Endzeitpunkt für einen MTO-Auftrag
  private calculateLatestEndTime = (order: ProductionOrder, route: ProductionRoute): number => {
    // Due Date in Minuten seit Beginn der Planung
    const dueDate = new Date(order.dueDate).getTime();
    
    // Übersetze in Minuten seit Planungsbeginn - muss noch implementiert werden
    // Hier nehmen wir an, dass das Due Date bereits in Minuten vorliegt
    return dueDate;
  }

  // ÜBERNAHME VON FUNKTIONEN AUS DEM URSPRÜNGLICHEN CODE
  // Diese Funktionen werden aus dem Original-Code wiederverwendet

  // Findet die Route für einen bestimmten Auftrag basierend auf der Teilenummer
  private findRouteForOrder = (partNumber: string): ProductionRoute | undefined => {
    return this.routes.find(route => route.partNumber === partNumber);
  };

  // Findet alle geeigneten Maschinen für eine Maschinengruppe und Teilenummer
  private findCapableMachinesInGroup = (
    groupId: number,
    partNumber: string
  ): Machine[] => {
    return this.machines.filter(
      machine => 
        machine.groupId === groupId && 
        machine.capablePartNumbers.includes(partNumber)
    );
  };

  // Bewertet, welche Maschine aus einer Gruppe am besten für einen Auftrag geeignet ist
  private findOptimalMachineForOrder = (
    capableMachines: Machine[],
    order: ProductionOrder,
    machineSchedules: MachineSchedule[],
    currentTime: number
  ): { machineId: number, startTime: number, setupTime: number } => {
    let bestMachineId = -1;
    let earliestStartTime = Number.MAX_SAFE_INTEGER;
    let requiredSetupTime = 0;
    
    if (capableMachines.length === 0) {
      this.addLog(`Keine fähige Maschine für Teilenummer ${order.partNumber} gefunden!`);
      return { machineId: -1, startTime: 0, setupTime: 0 };
    }

    let bestScore = Number.NEGATIVE_INFINITY;
    
    const dueDate = new Date(order.dueDate).getTime();
    
    for (const machine of capableMachines) {
      const { startTime, setupTime } = this.findEarliestStartTimeForMachine(
        machine.id, 
        order,
        machineSchedules
      );
      
      const actualStartTime = Math.max(startTime, currentTime);
      const processingTime = this.calculateProcessingTime(order.partNumber, order.lotSize, machine.id);
      const endTime = actualStartTime + setupTime + processingTime;
      const totalJobTime = setupTime + processingTime;
      const setupRatio = setupTime / totalJobTime;
      const machineLoad = this.calculateMachineLoad(machine.id, machineSchedules);
      
      // Due Date Abweichung (in Minuten) berechnen
      const endDateAsTime = endTime * 60 * 1000; // Konvertiere in MS
      const dueDateDeviation = (endDateAsTime - dueDate) / (60 * 1000);
      
          // Prüfe, ob diese Maschine zu einer Engpass-Gruppe gehört und wie hoch der Engpass-Score ist
      const bottleneckScore = this.bottleneckGroupsCache.get(machine.groupId) || 0;
      const isBottleneck = bottleneckScore > 0.6; // Signifikanter Engpass ab 0.6
      
      // Normalisierung der Bewertungskriterien für bessere Vergleichbarkeit
      // Jeder Faktor wird auf einen ähnlichen Wertebereich normalisiert
      
      // 1. Startzeit - normalisiert gegen eine typische Schichtdauer (8 Stunden = 480 Minuten)
      const normalizedStartTime = Math.min(1.0, actualStartTime / 480);
      
      // 2. Endzeit - ähnlich normalisiert
      const normalizedEndTime = Math.min(1.0, endTime / 480);
      
      // 3. Rüstzeitverhältnis - bereits im Bereich 0-1
      // Wir bevorzugen kleinere Werte (weniger Rüstzeit)
      
      // 4. Maschinenauslastung - bereits im Bereich 0-1
      // Wir bevorzugen kleinere Werte (weniger ausgelastete Maschinen)
      
      // 5. Due Date Abweichung - normalisiert auf Basis einer typischen Toleranz
      // z.B. bis zu 3 Tage Verspätung (4320 Minuten)
      const normalizedDueDateDeviation = Math.min(1.0, Math.max(0, dueDateDeviation) / 4320);
      
      // 6. Bottleneck-Optimierung
      // Wir bestrafen hohe Auslastung bei Engpässen stärker
      const bottleneckImpact = isBottleneck ? machineLoad * bottleneckScore : 0;
      const normalizedBottleneckImpact = Math.min(1.0, bottleneckImpact);
      
      // Multi-Kriterienbewertung mit dynamischen Gewichtungen:
      const score = 
        -this.weights.startTime * normalizedStartTime +      
        -this.weights.endTime * normalizedEndTime +               
        -this.weights.setupTime * setupRatio +          
        -this.weights.machineLoad * machineLoad + 
        -this.weights.dueDate * normalizedDueDateDeviation +
        -this.weights.bottleneck * normalizedBottleneckImpact; // Separater Engpass-Faktor (γ)
      
      if (score > bestScore) {
        bestScore = score;
        earliestStartTime = actualStartTime;
        bestMachineId = machine.id;
        requiredSetupTime = setupTime;
      }
    }
    
    return { 
      machineId: bestMachineId, 
      startTime: earliestStartTime, 
      setupTime: requiredSetupTime 
    };
  };

  // Berechnet die aktuelle Auslastung einer Maschine
  private calculateMachineLoad = (machineId: number, machineSchedules: MachineSchedule[]): number => {
    // Prüfen, ob wir einen Cache-Treffer haben
    if (this.machineLoadsCache.has(machineId)) {
      return this.machineLoadsCache.get(machineId)!;
    }
    
    const machineSchedule = machineSchedules.find(ms => ms.machineId === machineId);
    
    if (!machineSchedule || machineSchedule.slots.length === 0) {
      this.machineLoadsCache.set(machineId, 0);
      return 0;
    }
    
    const lastSlot = machineSchedule.slots[machineSchedule.slots.length - 1];
    const totalWorkTime = lastSlot.end;
    
    const totalJobTime = machineSchedule.slots.reduce(
      (sum, slot) => sum + slot.processingTime + slot.setupTime, 
      0
    );
    
    const load = totalJobTime / totalWorkTime;
    
    // Speichere im Cache
    this.machineLoadsCache.set(machineId, load);
    
    return load;
  };

  // Berechnet die Rüstzeit zwischen zwei Produkten basierend auf Teilenummer
  private calculateSetupTime = (fromPartNumber: string, toPartNumber: string): number => {
    if (fromPartNumber === toPartNumber) {
      return 0;
    }
    
    let setupTime = 0;
    try {
      setupTime = this.setupMatrix[fromPartNumber]?.[toPartNumber] ?? 0;
      if (setupTime === 0 && fromPartNumber !== toPartNumber) {
        setupTime = 10; // Standardwert für Rüstzeit, wenn nicht definiert
      }
    } catch (error) {
      setupTime = 10; // Fallback bei Fehler
    }
    
    return setupTime;
  };

  // Berechnet die Bearbeitungszeit für ein Produkt basierend auf Teilenummer und Maschine
  private calculateProcessingTime = (partNumber: string, lotSize: number, machineId?: number): number => {
    let cycleTime = 0;
    try {
      let machineName = '';
      if (machineId) {
        const machine = this.machines.find(m => m.id === machineId);
        if (machine) {
          machineName = machine.name;
        }
      }
      
      if (machineName && this.cycleMatrix[partNumber]?.[machineName]) {
        cycleTime = this.cycleMatrix[partNumber][machineName];
      } 
      else if (this.cycleMatrix[partNumber]?.[partNumber]) {
        cycleTime = this.cycleMatrix[partNumber][partNumber];
      } else {
        cycleTime = 1; // Standardwert, wenn keine Taktzeit definiert ist
      }
    } catch (error) {
      cycleTime = 1; // Fallback bei Fehler
    }
    
    return cycleTime * lotSize;
  };

  // Findet den frühestmöglichen Startzeitpunkt für einen Auftrag auf einer Maschine
  private findEarliestStartTimeForMachine = (
    machineId: number, 
    order: ProductionOrder, 
    machineSchedules: MachineSchedule[]
  ): { startTime: number, setupTime: number } => {
    const machineSchedule = machineSchedules.find(ms => ms.machineId === machineId);

    if (!machineSchedule || machineSchedule.slots.length === 0) {
      return { startTime: 0, setupTime: 0 };
    }

    const lastSlot = machineSchedule.slots[machineSchedule.slots.length - 1];
    let setupTime = this.calculateSetupTime(lastSlot.partNumber, order.partNumber);

    return { 
      startTime: lastSlot.end, 
      setupTime 
    };
  };

  // Findet optimale Startzeit für einen Auftrag gemäß seiner Route
  private findOptimalStartTimeForRoute = (
    route: ProductionRoute, 
    order: ProductionOrder,
    machineSchedules: MachineSchedule[]
  ): { schedules: MachineSchedule[], totalDuration: number } => {
    let updatedMachineSchedules = [...machineSchedules];
    let currentTime = 0;
    let totalDuration = 0;

    for (let i = 0; i < route.sequence.length; i++) {
      const groupId = route.sequence[i];
      const capableMachines = this.findCapableMachinesInGroup(groupId, order.partNumber);
      
      if (capableMachines.length === 0) {
        this.addLog(`⚠️ Keine fähige Maschine in Gruppe ${groupId} für ${order.partNumber} gefunden!`);
        continue;
      }
      
      const { machineId, startTime, setupTime } = this.findOptimalMachineForOrder(
        capableMachines,
        order,
        updatedMachineSchedules,
        currentTime
      );
      
      if (machineId === -1) {
        this.addLog(`⚠️ Konnte keine optimale Maschine in Gruppe ${groupId} für ${order.partNumber} finden!`);
        continue;
      }

      const actualStartTime = Math.max(startTime, currentTime);
      const processingTime = this.calculateProcessingTime(order.partNumber, order.lotSize, machineId);
      const endTime = actualStartTime + setupTime + processingTime;
      
      const newSlot: ScheduleItem = {
        orderName: order.name,
        partNumber: order.partNumber,
        reportNumber: order.reportNumber,
        machineId,
        start: actualStartTime,
        end: endTime,
        setupTime,
        processingTime,
        type: order.type // Typ des Auftrags für die Visualisierung
      };

      const machineIndex = updatedMachineSchedules.findIndex(ms => ms.machineId === machineId);
      
      if (machineIndex >= 0) {
        updatedMachineSchedules[machineIndex].slots.push(newSlot);
      } else {
        const machine = this.machines.find(m => m.id === machineId);
        updatedMachineSchedules.push({
          machineId,
          machineName: machine?.name || `Maschine ${machineId}`,
          slots: [newSlot]
        });
      }

      currentTime = endTime;
      totalDuration = Math.max(totalDuration, endTime);
    }

    return { schedules: updatedMachineSchedules, totalDuration };
  };

  // Speziell für MTO: Findet die optimale Position für einen MTO-Auftrag
  private findOptimalStartTimeForMTOOrder = (
    route: ProductionRoute, 
    order: ProductionOrder,
    machineSchedules: MachineSchedule[],
    latestPossibleEndTime: number
  ): { schedules: MachineSchedule[], totalDuration: number } => {
    // Für MTO-Aufträge ist die Einhaltung des Due Date wichtiger
    // Wir erhöhen das Gewicht des Due Date-Faktors temporär
    const originalDueWeight = this.weights.dueDate;
    this.weights.dueDate *= 2; // Verdopple die Wichtigkeit des Due Date für MTO-Aufträge
    
    // Verwende die Standard-Funktion mit erhöhter Due Date-Gewichtung
    const result = this.findOptimalStartTimeForRoute(route, order, machineSchedules);
    
    // Gewicht zurücksetzen
    this.weights.dueDate = originalDueWeight;
    
    return result;
  }

  // Log-Funktion
  private addLog = (message: string): void => {
    this.addLogCallback(message);
  }
}

export default MTOMTSScheduler;
