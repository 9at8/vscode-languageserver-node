/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	SemanticTokens, SemanticTokensPartialResult, SemanticTokensDelta, SemanticTokensDeltaPartialResult, SemanticTokensParams,
	SemanticTokensRequest, SemanticTokensDeltaParams, SemanticTokensDeltaRequest, SemanticTokensRangeParams, SemanticTokensRangeRequest,
	SemanticTokensRefreshRequest, SemanticTokensEdit
} from 'vscode-languageserver-protocol';

import type { Feature, _Languages, ServerRequestHandler } from './server';

/**
 * Shape of the semantic token feature
 *
 * @since 3.16.0
 */
export interface SemanticTokensFeatureShape {
	semanticTokens: {
		refresh(): void;
		on(handler: ServerRequestHandler<SemanticTokensParams, SemanticTokens, SemanticTokensPartialResult, void>): void;
		onDelta(handler: ServerRequestHandler<SemanticTokensDeltaParams, SemanticTokensDelta | SemanticTokens, SemanticTokensDeltaPartialResult | SemanticTokensDeltaPartialResult, void>): void;
		onRange(handler: ServerRequestHandler<SemanticTokensRangeParams, SemanticTokens, SemanticTokensPartialResult, void>): void;
	}
}

export const SemanticTokensFeature: Feature<_Languages, SemanticTokensFeatureShape> = (Base) => {
	return class extends Base {
		public get semanticTokens() {
			return {
				refresh: (): Promise<void> => {
					return this.connection.sendRequest(SemanticTokensRefreshRequest.type);
				},
				on: (handler: ServerRequestHandler<SemanticTokensParams, SemanticTokens, SemanticTokensPartialResult, void>): void => {
					const type = SemanticTokensRequest.type;
					this.connection.onRequest(type, (params, cancel) => {
						return handler(params, cancel, this.attachWorkDoneProgress(params), this.attachPartialResultProgress(type, params));
					});
				},
				onDelta: (handler: ServerRequestHandler<SemanticTokensDeltaParams, SemanticTokensDelta | SemanticTokens, SemanticTokensDeltaPartialResult | SemanticTokensDeltaPartialResult, void>): void => {
					const type = SemanticTokensDeltaRequest.type;
					this.connection.onRequest(type, (params, cancel) => {
						return handler(params, cancel, this.attachWorkDoneProgress(params), this.attachPartialResultProgress(type, params));
					});
				},
				onRange: (handler: ServerRequestHandler<SemanticTokensRangeParams, SemanticTokens, SemanticTokensPartialResult, void>): void => {
					const type = SemanticTokensRangeRequest.type;
					this.connection.onRequest(type, (params, cancel) => {
						return handler(params, cancel, this.attachWorkDoneProgress(params), this.attachPartialResultProgress(type, params));
					});
				}
			};
		}
	};
};

export class SemanticTokensDiff {
	private readonly originalSequence: number[];
	private readonly modifiedSequence: number[];

	constructor (originalSequence: number[], modifiedSequence: number[]) {
		this.originalSequence = originalSequence;
		this.modifiedSequence = modifiedSequence;
	}

	public computeDiff(): SemanticTokensEdit[] {
		const originalLength = this.originalSequence.length;
		const modifiedLength = this.modifiedSequence.length;
		let startIndex = 0;
		while(startIndex < modifiedLength && startIndex < originalLength && this.originalSequence[startIndex] === this.modifiedSequence[startIndex]) {
			startIndex++;
		}
		if (startIndex < modifiedLength && startIndex < originalLength) {
			// Find end index
			let endIndex = 0;
			while (endIndex < modifiedLength && endIndex < originalLength && this.originalSequence[originalLength - 1 - endIndex] === this.modifiedSequence[modifiedLength - 1 - endIndex]) {
				endIndex++;
			}
			// The endIndex moves from the back to the front and denotes now the first number that is different.
			// Since the endIndex on slice is exclusive we need to subtract one to move one number to the back.
			endIndex--;
			const newData = this.modifiedSequence.slice(startIndex, modifiedLength - endIndex);
			return [
				{ start: startIndex, deleteCount: originalLength - endIndex - startIndex, data: newData }
			];
		} else if (startIndex < modifiedLength) {
			return [
				{ start: startIndex, deleteCount: 0, data: this.modifiedSequence.slice(startIndex) }
			];
		} else if (startIndex < originalLength) {
			return [
				{ start: startIndex, deleteCount: originalLength - startIndex }
			];
		} else {
			return [];
		}
	}
}

export class SemanticTokensBuilder {

	private _id!: number;

	private _prevLine!: number;
	private _prevChar!: number;
	private _data!: number[];
	private _dataLen!: number;

	private _prevData: number[] | undefined;

	constructor() {
		this._prevData = undefined;
		this.initialize();
	}

	private initialize() {
		this._id = Date.now();
		this._prevLine = 0;
		this._prevChar = 0;
		this._data = [];
		this._dataLen = 0;
	}

	public push(line: number, char: number, length: number, tokenType: number, tokenModifiers: number): void {
		let pushLine = line;
		let pushChar = char;
		if (this._dataLen > 0) {
			pushLine -= this._prevLine;
			if (pushLine === 0) {
				pushChar -= this._prevChar;
			}
		}

		this._data[this._dataLen++] = pushLine;
		this._data[this._dataLen++] = pushChar;
		this._data[this._dataLen++] = length;
		this._data[this._dataLen++] = tokenType;
		this._data[this._dataLen++] = tokenModifiers;

		this._prevLine = line;
		this._prevChar = char;
	}

	public get id(): string {
		return this._id.toString();
	}

	public previousResult(id: string) {
		if (this.id === id) {
			this._prevData = this._data;
		}
		this.initialize();
	}

	public build(): SemanticTokens {
		this._prevData = undefined;
		return {
			resultId: this.id,
			data: this._data
		};
	}

	public canBuildEdits(): boolean {
		return this._prevData !== undefined;
	}

	public buildEdits(): SemanticTokens | SemanticTokensDelta {
		if (this._prevData !== undefined) {
			return {
				resultId: this.id,
				edits: (new SemanticTokensDiff(this._prevData, this._data)).computeDiff()
			};
		} else {
			return this.build();
		}
	}
}