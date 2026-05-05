// import { Component, Output, EventEmitter } from '@angular/core';
// import { CommonModule } from '@angular/common';

// export type ToolType = 'trendline' | 'select' | 'delete';

// @Component({
//   selector: 'app-toolbar',
//   standalone: true,
//   imports: [CommonModule],
//   templateUrl: './toolbar.component.html',
//   styleUrls: ['./toolbar.component.scss']
// })
// export class ToolbarComponent {
//   @Output() toolSelected = new EventEmitter<ToolType>();
//   activeTool: ToolType = 'trendline';

//   selectTool(tool: ToolType): void {
//     this.activeTool = tool;
//     this.toolSelected.emit(tool);
//     console.log('Tool selected:', tool);
//   }
// }