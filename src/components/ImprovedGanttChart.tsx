// ImprovedGanttChart.tsx
import React, { useState } from 'react';
import { format, addDays } from 'date-fns';
import { de } from 'date-fns/locale';
import './ganttConnectivityFix.css'; // Importiere zusätzliches CSS für verbundene Balken
import './mtoMtsStyles.css'; // Importiere MTO/MTS-spezifische Stile

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

interface GanttChartProps {
  schedule: MachineSchedule[];
  orders: ProductionOrder[];
  startDate: string;
  formatDuration: (minutes: number) => string;
  bottleneckGroups?: number[]; // Neue Prop für Engpass-Maschinengruppen
}

const ImprovedGanttChart: React.FC<GanttChartProps> = ({
  schedule,
  orders,
  startDate,
  formatDuration,
  bottleneckGroups = [] // Standardwert für Engpassgruppen
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  
  if (schedule.length === 0) return null;
  
  // Startdatum als Date-Objekt
  const scheduleStartDate = new Date(startDate);
  
  // Finde das Maximum der Endzeiten über alle Maschinen
  const maxEndMinutes = schedule.reduce((max, machine) => {
    const machineMaxEnd = machine.slots.reduce((mmax, slot) => Math.max(mmax, slot.end), 0);
    return Math.max(max, machineMaxEnd);
  }, 0);
  
  // Berechne die Anzahl der Tage für das Gantt-Diagramm (mindestens 1)
  const totalDays = Math.max(1, Math.ceil(maxEndMinutes / (24 * 60)));
  const daysList = Array.from({ length: totalDays }, (_, i) => i);
  
  // Aktuelles Datum für Hervorhebung
  const currentDate = new Date();
  const currentDateFormatted = format(currentDate, 'yyyy-MM-dd');
  
  // Funktion zum Anpassen des Zoom-Levels
  const handleZoomChange = (newZoom: number) => {
    if (newZoom >= 0.5 && newZoom <= 2) {
      setZoomLevel(newZoom);
    }
  };
  
  // Generiert die Header mit den Tagen
  const renderDayHeaders = () => {
    return daysList.map(dayOffset => {
      const day = addDays(scheduleStartDate, dayOffset);
      const isDayToday = format(day, 'yyyy-MM-dd') === currentDateFormatted;
      
      // Vier Stundenabschnitte pro Tag (ohne Text-Labels)
      const hourMarkers = [0, 6, 12, 18].map((hour, idx) => (
        <div key={idx} className="gantt-hour-mark" title={`${hour}:00 Uhr`}>
          {/* Keine sichtbaren Labels mehr, nur Markierungen */}
        </div>
      ));
      
      return (
        <div 
          key={dayOffset} 
          className={`gantt-day-header ${isDayToday ? 'today' : ''}`}
          style={{ minWidth: `${120 * zoomLevel}px` }}
        >
          <div className="gantt-day-title">
            {format(day, 'EEE, d. MMM', { locale: de })}
          </div>
          <div className="gantt-hour-marks">
            {hourMarkers}
          </div>
        </div>
      );
    });
  };
  
  // Prüft, ob ein Slot an einem bestimmten Tag beginnt oder aktiv ist
  const isSlotActiveOnDay = (slot: ScheduleItem, dayOffset: number) => {
    const dayMinutesStart = dayOffset * 24 * 60;
    const dayMinutesEnd = (dayOffset + 1) * 24 * 60;
    
    return (
      (slot.start >= dayMinutesStart && slot.start < dayMinutesEnd) ||
      (slot.start < dayMinutesStart && slot.end > dayMinutesStart)
    );
  };
  
  // Berechnet die Position und Breite eines Slots im Gantt-Diagramm
  const calculateSlotPosition = (slot: ScheduleItem, dayOffset: number) => {
    const dayMinutesStart = dayOffset * 24 * 60;
    const dayMinutesEnd = (dayOffset + 1) * 24 * 60;
    
    const slotStartInDay = Math.max(slot.start, dayMinutesStart);
    const slotEndInDay = Math.min(slot.end, dayMinutesEnd);
    
    const leftPercent = ((slotStartInDay - dayMinutesStart) / (24 * 60)) * 100;
    const widthPercent = ((slotEndInDay - slotStartInDay) / (24 * 60)) * 100;
    
    return { leftPercent, widthPercent };
  };
  
  // Rendert die Slots für ein bestimmtes Maschinenschema
  const renderMachineSlots = (machineSchedule: MachineSchedule) => {
    return daysList.map(dayOffset => (
      <div 
        key={dayOffset} 
        className="gantt-day-column"
        style={{ minWidth: `${120 * zoomLevel}px` }}
      >
        {machineSchedule.slots
          .filter(slot => isSlotActiveOnDay(slot, dayOffset))
          .map((slot, slotIdx, slotsArray) => {
            const { leftPercent, widthPercent } = calculateSlotPosition(slot, dayOffset);
            const order = orders.find(o => o.name === slot.orderName);
            const isLate = order && 
              new Date(scheduleStartDate.getTime() + slot.end * 60 * 1000) > new Date(order.dueDate);
            
            // Prüfen, ob dieser Auftrag in der gleichen Sequenz ist wie der vorherige
            const previousSlot = slotsArray[slotIdx - 1];
            const isSequential = previousSlot && 
                                 previousSlot.orderName === slot.orderName &&
                                 Math.abs(previousSlot.end - slot.start) < 5; // Kleiner Puffer für Rundungsfehler
            
            // Formatieren der Start- und Endzeiten
            const startTime = new Date(scheduleStartDate.getTime() + slot.start * 60 * 1000);
            const endTime = new Date(scheduleStartDate.getTime() + slot.end * 60 * 1000);
            
            // Verbesserter Tooltip mit strukturierterem Inhalt
            const tooltipContent = `
              🔹 Auftragsinformation 🔹
              Auftrag: ${slot.orderName}
              Teilenummer: ${slot.partNumber}
              Rückmeldenummer: ${slot.reportNumber}
              Typ: ${order?.type || 'Unbekannt'}
              Losgröße: ${order?.lotSize || 'Unbekannt'}
              
              ⏱️ Zeitplanung ⏱️
              Start: ${format(startTime, 'dd.MM.yyyy HH:mm', { locale: de })}
              Ende: ${format(endTime, 'dd.MM.yyyy HH:mm', { locale: de })}
              Gesamtdauer: ${formatDuration(slot.processingTime + slot.setupTime)}
              Bearbeitungszeit: ${formatDuration(slot.processingTime)}
              Rüstzeit: ${formatDuration(slot.setupTime)}
              ${order && isLate ? '⚠️ VERSPÄTETE LIEFERUNG ⚠️' : '✅ Fristgerechte Lieferung'}
              
              Due Date: ${order ? format(new Date(order.dueDate), 'dd.MM.yyyy', { locale: de }) : 'Unbekannt'}
            `;
            
            // Bestimme den Auftragstyp - entweder aus dem Slot selbst (wenn vorhanden) oder aus dem order-Objekt
            const orderType = slot.type || order?.type || 'Make to Stock';
            
            return (
              <div 
                key={`${dayOffset}-${slotIdx}`}
                className={`gantt-bar ${orderType === 'Make to Order' ? 'make-to-order' : 'make-to-stock'} ${isLate ? 'late' : ''} ${isSequential ? 'sequential-task' : ''}`}
                style={{ 
                  left: `${leftPercent}%`, /* Exakte Positionierung ohne Überlappung */
                  width: `${widthPercent}%` /* Exakte Breite ohne künstliche Verbreiterung */
                }}
                data-sequential={isSequential ? "true" : "false"}
                data-order-type={orderType}
                title={tooltipContent}
              >
                <div className="gantt-bar-label">
                  {slot.orderName} - {slot.partNumber}
                  {orderType === 'Make to Order' && <span className="mto-indicator">MTO</span>}
                </div>
                {slot.setupTime > 0 && (
                  <div 
                    className="gantt-setup" 
                    style={{ width: `${(slot.setupTime / (slot.processingTime + slot.setupTime)) * 100}%` }}
                    title={`Rüstzeit: ${formatDuration(slot.setupTime)}`}
                  />
                )}
              </div>
            );
          })}
      </div>
    ));
  };
  
  // Berechnen, ob der heutige Tag im Diagramm angezeigt wird
  const daysSinceStart = Math.floor((currentDate.getTime() - scheduleStartDate.getTime()) / (1000 * 60 * 60 * 24));
  const showTodayMarker = daysSinceStart >= 0 && daysSinceStart < totalDays;
  
  return (
    <div className="gantt-outer-container">
      {/* Steuerungselemente für das Gantt-Diagramm */}
      <div className="gantt-controls">
        <div className="gantt-legend">
          <div className="gantt-legend-item">
            <div className="gantt-legend-color legend-make-to-stock"></div>
            <span>Make to Stock</span>
          </div>
          <div className="gantt-legend-item">
            <div className="gantt-legend-color legend-make-to-order"></div>
            <span>Make to Order</span>
          </div>
          <div className="gantt-legend-item">
            <div className="gantt-legend-color legend-late"></div>
            <span>Verspätete Auslieferung</span>
          </div>
          <div className="gantt-legend-item">
            <div className="gantt-legend-color legend-setup"></div>
            <span>Rüstzeit</span>
          </div>
        </div>
        
        <div className="gantt-zoom-controls">
          <button 
            className="gantt-zoom-btn" 
            onClick={() => handleZoomChange(zoomLevel - 0.1)}
            disabled={zoomLevel <= 0.5}
            title="Verkleinern"
          >
            –
          </button>
          <span className="gantt-zoom-level">{Math.round(zoomLevel * 100)}%</span>
          <button 
            className="gantt-zoom-btn" 
            onClick={() => handleZoomChange(zoomLevel + 0.1)}
            disabled={zoomLevel >= 2}
            title="Vergrößern"
          >
            +
          </button>
          <button 
            className="gantt-zoom-btn" 
            onClick={() => setZoomLevel(1)}
            title="Zoom zurücksetzen"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="gantt-container">
        <div className="gantt-scrollable-area">
          <div className="gantt-content" style={{ width: `${totalDays * 120 * zoomLevel + 200}px` }}>
            {/* Header mit Tagesanzeige */}
            <div className="gantt-header">
              <div className="gantt-header-spacer">Maschine</div>
              <div className="gantt-days-container">
                {renderDayHeaders()}
              </div>
            </div>
            
            {/* Zeilen für jede Maschine */}
            {schedule.map((machineSchedule, idx) => {
              // Finde die zugehörige Maschine und prüfe, ob sie ein Bottleneck ist
              const isBottleneck = bottleneckGroups.includes(
                machineSchedule.machineId % 100 // Einfache Heuristik, um Maschinengruppen-ID aus Maschinen-ID abzuleiten
              );
              
              return (
                <div key={idx} className={`gantt-row ${isBottleneck ? 'bottleneck-machine' : ''}`}>
                  <div 
                    className="gantt-row-header" 
                    title={`Maschine: ${machineSchedule.machineName} (ID: ${machineSchedule.machineId})${isBottleneck ? ' - Engpass-Maschine' : ''}`}
                  >
                    {machineSchedule.machineName}
                    {isBottleneck && <span className="bottleneck-indicator"> (Engpass)</span>}
                  </div>
                  <div className="gantt-timeline">
                    {/* Heute-Markierung anzeigen, falls relevant */}
                    {showTodayMarker && (
                      <div 
                        className="gantt-today-marker" 
                        style={{
                          left: `${daysSinceStart * (120 * zoomLevel) + ((currentDate.getHours() * 60 + currentDate.getMinutes()) / (24 * 60) * (120 * zoomLevel))}px`
                        }}
                        title={`Heute: ${format(currentDate, 'dd.MM.yyyy HH:mm', { locale: de })}`}
                      />
                    )}
                    {renderMachineSlots(machineSchedule)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImprovedGanttChart;
