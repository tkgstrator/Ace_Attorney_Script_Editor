// SDAT の SSEQ を NCSF の再生部（pret の SND ドライバーの移植）でそのまま WAV にする。
// NCSF123 との違い: 1 フレーム = 170.5 サンプル（f*341/2 で区切る。NCSF123 は 171 に丸めるので 0.3% 遅れる）、
// フェード・ReplayGain・無音の飛ばしをしない。補間はなし（DS と同じ）。
// 使い方: NcsfRender <sound_data.sdat> <jobs.tsv>   jobs.tsv の各行 = sdatIndex \t samples \t out.wav [\t トラックの消音のビット]
using NCSFPlayer;

var sdatPath = args[0];
var sdatBytes = File.ReadAllBytes(sdatPath);
const uint Rate = 32728;
foreach (var line in File.ReadAllLines(args[1]))
{
	if (string.IsNullOrWhiteSpace(line)) continue;
	var cols = line.Split('\t');
	uint index = uint.Parse(cols[0]);
	long samples = long.Parse(cols[1]);
	string outPath = cols[2];

	NCSFCommon.NC.SDAT sdat = new();
	try
	{
		sdat.Read(Path.GetFileName(sdatPath), sdatBytes, index);
	}
	catch (Exception e)
	{
		// 読めないもの（空の項目・波形の足りないバンクなど）は飛ばして次へ
		Console.WriteLine($"{index}\tskip\t{e.Message}");
		continue;
	}
	Player player = new()
	{
		ChannelMask = sdat.Player?.ChannelMask ?? 0xFFFF,
		SampleRate = Rate,
		Interpolation = Interpolation.None,
		// 4 列目があればトラックの消音（ビット）。比べるときに 1 トラックずつ鳴らす
		TrackMutes = cols.Length > 3 ? ushort.Parse(cols[3]) : (ushort)0,
	};
	var sseq = sdat.SSEQs[0];
	player.PrepareSequence(sseq, 0, NCSFCommon.NCSF.ConvertScale(sseq.Info!.Volume == 0 ? 0x7F : sseq.Info.Volume));
	player.SBNK = sdat.SBNKs[0];
	for (int i = 0, j = 0; i < 4; ++i)
		if (player.SBNK.Info!.WaveArchives[i] != 0xFFFF)
			player.SetSWAR(i, sdat.SWARs[j++]);

	var pcm = new short[samples * 2];
	long frame = 0, next = 0;
	int clipped = 0;
	float peak = 0;
	for (long s = 0; s < samples; ++s)
	{
		// フレームの頭でシーケンスを 1 回進める（自前の render.rs の frame_start と同じ区切り）
		while (s >= next)
		{
			player.SequenceMain();
			++frame;
			next = frame * 341 / 2;
		}
		float l = 0, r = 0;
		for (int i = 0; i < NCSFCommon.Player.ChannelCount; ++i)
		{
			var chn = player.Channels[i];
			if (chn.IsActive() && chn.Register.Enable)
			{
				float v = chn.GenerateSample();
				chn.IncrementSample();
				v = NCSFCommon.Player.MulDiv7(v, chn.Register.VolumeMultiplier) * chn.Register.VolumeDivisor switch
				{
					1 => 0.5f,
					2 => 0.25f,
					3 => 0.0625f,
					_ => 1
				};
				l += NCSFCommon.Player.MulDiv7(v, (byte)(127 - chn.Register.Panning));
				r += NCSFCommon.Player.MulDiv7(v, chn.Register.Panning);
			}
		}
		peak = Math.Max(peak, Math.Max(Math.Abs(l), Math.Abs(r)));
		if (Math.Abs(l) > 1 || Math.Abs(r) > 1) ++clipped;
		pcm[2 * s] = (short)(Math.Clamp(l, -1f, 1f) * short.MaxValue);
		pcm[2 * s + 1] = (short)(Math.Clamp(r, -1f, 1f) * short.MaxValue);
	}
	player.Stop();

	Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outPath))!);
	using var fs = File.Create(outPath);
	using var w = new BinaryWriter(fs);
	int dataLen = (int)(samples * 4);
	w.Write("RIFF"u8); w.Write(dataLen + 36); w.Write("WAVE"u8);
	w.Write("fmt "u8); w.Write(16); w.Write((short)1); w.Write((short)2); w.Write((int)Rate); w.Write((int)Rate * 4); w.Write((short)4); w.Write((short)16);
	w.Write("data"u8); w.Write(dataLen);
	var bytes = System.Runtime.InteropServices.MemoryMarshal.AsBytes(pcm.AsSpan());
	w.Write(bytes);
	Console.WriteLine($"{index}\t{outPath}\tpeak={peak:F4}\tclipped={clipped}");
}
