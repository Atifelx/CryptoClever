'use client';

import { useState } from 'react';
import { processMT4Indicator } from '../../lib/mt4Reader';
import { Upload, FileText, AlertCircle, CheckCircle } from 'lucide-react';

export default function MT4IndicatorUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    type: 'mq4' | 'ex4' | 'unknown';
    data?: any;
    message: string;
    typescriptStub?: string;
  } | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleProcess = async () => {
    if (!file) return;

    setProcessing(true);
    try {
      const result = await processMT4Indicator(file);
      setResult(result);
    } catch (error) {
      setResult({
        success: false,
        type: 'unknown',
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="w-5 h-5 text-teal-500" />
        <h3 className="text-white font-semibold">MT4 Indicator Reader</h3>
      </div>

      <div className="space-y-3">
        {/* File Input */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            Upload MT4 Indicator File
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 px-4 py-2 bg-[#2a2a2a] border border-gray-700 rounded cursor-pointer hover:bg-[#3a3a3a] transition-colors">
              <Upload className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-300">Choose File</span>
              <input
                type="file"
                accept=".mq4,.ex4"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
            {file && (
              <span className="text-sm text-gray-400">
                {file.name}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Supports .mq4 (source) and .ex4 (compiled) files
          </p>
        </div>

        {/* Process Button */}
        {file && (
          <button
            onClick={handleProcess}
            disabled={processing}
            className="w-full px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded transition-colors"
          >
            {processing ? 'Processing...' : 'Process Indicator'}
          </button>
        )}

        {/* Result Display */}
        {result && (
          <div className={`p-4 rounded border ${
            result.success 
              ? 'bg-green-900/20 border-green-700' 
              : 'bg-red-900/20 border-red-700'
          }`}>
            <div className="flex items-start gap-3">
              {result.success ? (
                <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 space-y-2">
                <div>
                  <div className="text-sm font-semibold text-white mb-1">
                    {result.success ? 'Success' : 'Error'}
                  </div>
                  <div className="text-sm text-gray-300">
                    {result.message}
                  </div>
                </div>

                {result.success && result.data && (
                  <div className="mt-3 space-y-2">
                    <div className="text-xs text-gray-400">
                      <strong>Indicator Name:</strong> {result.data.indicatorName || 'Unknown'}
                    </div>
                    {Object.keys(result.data.inputs || {}).length > 0 && (
                      <div className="text-xs text-gray-400">
                        <strong>Inputs:</strong> {Object.keys(result.data.inputs).join(', ')}
                      </div>
                    )}
                    {result.data.buffers && result.data.buffers.length > 0 && (
                      <div className="text-xs text-gray-400">
                        <strong>Buffers:</strong> {result.data.buffers.join(', ')}
                      </div>
                    )}
                  </div>
                )}

                {result.typescriptStub && (
                  <div className="mt-3">
                    <div className="text-xs text-gray-400 mb-2">
                      <strong>TypeScript Stub Generated:</strong>
                    </div>
                    <pre className="bg-[#0a0a0a] p-3 rounded text-xs text-gray-300 overflow-x-auto max-h-60 overflow-y-auto">
                      {result.typescriptStub}
                    </pre>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(result.typescriptStub || '');
                        alert('Copied to clipboard!');
                      }}
                      className="mt-2 text-xs text-teal-500 hover:text-teal-400"
                    >
                      Copy to Clipboard
                    </button>
                  </div>
                )}

                {!result.success && result.data && (
                  <div className="mt-3 text-xs text-gray-400">
                    <div><strong>File Size:</strong> {result.data.fileSize} bytes</div>
                    {result.data.foundStrings && result.data.foundStrings.length > 0 && (
                      <div className="mt-2">
                        <strong>Found Strings:</strong>
                        <ul className="list-disc list-inside mt-1">
                          {result.data.foundStrings.slice(0, 5).map((s: string, i: number) => (
                            <li key={i} className="text-gray-500">{s.substring(0, 50)}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="bg-[#0a0a0a] border border-gray-800 rounded p-3 text-xs text-gray-400 space-y-1">
          <div className="font-semibold text-gray-300 mb-2">📋 Important Notes:</div>
          <div>• <strong>.mq4 files</strong> (source code) can be fully parsed and converted</div>
          <div>• <strong>.ex4 files</strong> (compiled) are binary - cannot extract logic directly</div>
          <div>• For .ex4 files, you need the original .mq4 source code</div>
          <div>• This tool generates TypeScript stubs that you can implement manually</div>
        </div>
      </div>
    </div>
  );
}
