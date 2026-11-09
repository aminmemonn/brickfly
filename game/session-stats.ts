export interface SessionStatsSnapshot {
  /** Metres flown since the page loaded. */
  distance: number;
  topSpeed: number;
  /** Distinct landmarks flown past this session. */
  landmarks: number;
  /** How many of those were first-ever discoveries. */
  newLandmarks: number;
}

export class SessionStats {
  private topSpeed = 0;
  private visited = new Set<string>();
  private discovered = new Set<string>();

  recordSpeed(speed: number): void {
    if (speed > this.topSpeed) this.topSpeed = speed;
  }

  recordLandmark(id: string, isNew: boolean): void {
    this.visited.add(id);
    if (isNew) this.discovered.add(id);
  }

  snapshot(distance: number): SessionStatsSnapshot {
    return {
      distance,
      topSpeed: this.topSpeed,
      landmarks: this.visited.size,
      newLandmarks: this.discovered.size
    };
  }
}
