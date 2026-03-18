'use strict';

// Domain Core: UI/DB/프레임워크/네트워크 import 금지 (C002)
// 이 서비스는 도메인 규칙만 알고 있다. 저장소(Repository)는 포트를 통해 주입된다.

class TaskDomainService {
  /**
   * 작업이 종료 상태(DONE, CANCELLED)인지 확인한다.
   * 종료 상태 작업에 대한 추가 변경을 방지하는 데 사용한다.
   */
  static isTerminal(task) {
    return task.status === 'DONE' || task.status === 'CANCELLED';
  }

  /**
   * 담당자 변경이 현재 작업 상태에서 허용되는지 확인한다.
   * 도메인 정책: DONE 상태 작업은 담당자 변경 불가.
   */
  static canReassign(task) {
    return task.status !== 'DONE';
  }

  /**
   * 마감일 초과 여부를 확인한다.
   * 보고 목적으로 사용. 이 자체가 상태 전이를 막지는 않는다.
   */
  static isOverdue(task) {
    if (!task.due_date) return false;
    const today = new Date().toISOString().slice(0, 10);
    return task.due_date < today && task.status !== 'DONE' && task.status !== 'CANCELLED';
  }
}

module.exports = { TaskDomainService };
